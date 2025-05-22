import { ChainConfigService, ChainClientManager, ContractInteractionService } from "@/services"
import { ADDRESS_ZERO, bytes32ToBytes20, ExecutionResult, FillOptions, HexString, Order } from "hyperbridge-sdk"
import { FillerStrategy } from "./base"
import { privateKeyToAddress } from "viem/accounts"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { encodeFunctionData } from "viem"
import { BATCH_EXECUTOR_ABI } from "@/config/abis/BatchExecutor"
import { UNISWAP_ROUTER_V2_ABI } from "@/config/abis/UniswapRouterV2"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { SafeService } from "@/services/SafeService"
import { safeConfig } from "@/config/chain"

export class StableSwapFiller implements FillerStrategy {
	name = "StableSwapFiller"
	private privateKey: HexString
	private clientManager: ChainClientManager
	private contractService: ContractInteractionService
	private configService: ChainConfigService
	private safeService!: SafeService

	constructor(privateKey: HexString) {
		this.privateKey = privateKey
		this.configService = new ChainConfigService()
		this.clientManager = new ChainClientManager(privateKey)
		this.contractService = new ContractInteractionService(this.clientManager, privateKey)
	}

	private async initializeSafeService(order: Order) {
		const chainConfig = safeConfig[order.destChain as keyof typeof safeConfig]
		if (!chainConfig) {
			throw new Error(`No Safe configuration found for chain ${order.destChain}`)
		}

		const provider = this.clientManager.getPublicClient(order.destChain).transport.url
		this.safeService = new SafeService(
			chainConfig.safeAddress as HexString,
			chainConfig.chainId,
			provider,
			this.privateKey,
		)
	}

	/**
	 * Checks the USD value of the filler's balance against the order's USD value
	 * @param order The order to check if it can be filled
	 * @returns True if the filler has enough balance, false otherwise
	 */
	async canFill(order: Order): Promise<boolean> {
		try {
			const destClient = this.clientManager.getPublicClient(order.destChain)
			const currentBlock = await destClient.getBlockNumber()
			const deadline = BigInt(order.deadline)

			if (deadline < currentBlock) {
				console.debug(`Order expired at block ${deadline}, current block ${currentBlock}`)
				return false
			}

			const isAlreadyFilled = await this.contractService.checkIfOrderFilled(order)
			if (isAlreadyFilled) {
				console.debug(`Order is already filled`)
				return false
			}

			const fillerBalanceUsd = await this.contractService.getFillerBalanceUSD(order, order.destChain)

			// Check if the filler has enough USD value to fill the order
			const { outputUsdValue } = await this.contractService.getTokenUsdValue(order)

			if (fillerBalanceUsd.totalBalanceUsd < outputUsdValue) {
				console.debug(`Insufficient USD value for order`)
				return false
			}

			return true
		} catch (error) {
			console.error(`Error in canFill:`, error)
			return false
		}
	}

	/**
	 * Calculates the USD value of the order's inputs, outputs, fees and compares
	 * what will the filler receive and what will the filler pay
	 * @param order The order to calculate the USD value for
	 * @returns The profit in USD (BigInt)
	 */
	async calculateProfitability(order: Order): Promise<bigint> {
		try {
			const { fillGas, postGas } = await this.contractService.estimateGasFillPost(order)
			const { totalGasEstimate } = await this.calculateSwapOperations(order, order.destChain)
			const nativeTokenPriceUsd = await this.contractService.getNativeTokenPriceUsd(order)

			const relayerFeeEth = postGas + (postGas * BigInt(200)) / BigInt(10000)

			const protocolFeeUSD = await this.contractService.getProtocolFeeUSD(order, relayerFeeEth)

			const totalGasWei = fillGas + relayerFeeEth + totalGasEstimate

			const gasCostUsd = (totalGasWei * nativeTokenPriceUsd) / BigInt(10 ** 18)

			const totalGasCostUsd = gasCostUsd + protocolFeeUSD

			const { outputUsdValue, inputUsdValue } = await this.contractService.getTokenUsdValue(order)

			const toReceive = outputUsdValue + order.fees
			const toPay = inputUsdValue + totalGasCostUsd

			const profit = toReceive - toPay

			return profit
		} catch (error) {
			console.error(`Error calculating profitability:`, error)
			return BigInt(0)
		}
	}

	async executeOrder(order: Order): Promise<ExecutionResult> {
		try {
			const { destClient, walletClient } = this.clientManager.getClientsForOrder(order)
			const startTime = Date.now()
			const fillerWalletAddress = privateKeyToAddress(this.privateKey)

			const { calls } = await this.calculateSwapOperations(order, order.destChain)

			const { postGas: postGasEstimate } = await this.contractService.estimateGasFillPost(order)
			const fillOptions: FillOptions = {
				relayerFee: postGasEstimate + (postGasEstimate * BigInt(200)) / BigInt(10000),
			}

			await this.contractService.approveTokensIfNeeded(order)

			const fillOrderData = encodeFunctionData({
				abi: INTENT_GATEWAY_ABI,
				functionName: "fillOrder",
				args: [this.contractService.transformOrderForContract(order), fillOptions as any],
			})

			calls.push({
				to: this.configService.getIntentGatewayAddress(order.destChain),
				data: fillOrderData,
				value: this.contractService.calculateRequiredEthValue(order.outputs),
			})

			const authorization = await walletClient.signAuthorization({
				contractAddress: this.configService.getBatchExecutorAddress(order.destChain),
				account: walletClient.account!,
			})

			const tx = await walletClient.sendTransaction({
				account: walletClient.account!,
				chain: destClient.chain,
				data: encodeFunctionData({
					abi: BATCH_EXECUTOR_ABI,
					functionName: "execute",
					args: [calls],
				}),
				to: fillerWalletAddress,
				authorizationList: [authorization],
			})

			const endTime = Date.now()
			const processingTimeMs = endTime - startTime

			const receipt = await destClient.waitForTransactionReceipt({ hash: tx })

			return {
				success: true,
				txHash: receipt.transactionHash,
				gasUsed: receipt.gasUsed.toString(),
				gasPrice: receipt.effectiveGasPrice.toString(),
				confirmedAtBlock: Number(receipt.blockNumber),
				confirmedAt: new Date(endTime),
				strategyUsed: this.name,
				processingTimeMs,
			}
		} catch (error) {
			console.error(`Error executing order:`, error)
			return {
				success: false,
			}
		}
	}

	async calculateSwapOperations(
		order: Order,
		destChain: string,
	): Promise<{ calls: { to: HexString; data: HexString; value: bigint }[]; totalGasEstimate: bigint }> {
		const contractService = this.contractService
		const cacheService = contractService.cacheService

		// Check cache first
		const cachedOperations = cacheService.getSwapOperations(order.id!)
		if (cachedOperations) {
			console.log(`Using cached swap operations for order ${order.id}`)
			return {
				calls: cachedOperations.calls.map((call) => ({
					to: call.to as HexString,
					data: call.data as HexString,
					value: BigInt(call.value),
				})),
				totalGasEstimate: cachedOperations.totalGasEstimate,
			}
		}

		const calls: { to: HexString; data: HexString; value: bigint }[] = []
		let totalGasEstimate = BigInt(0)
		const fillerWalletAddress = privateKeyToAddress(this.privateKey)
		const destClient = this.clientManager.getPublicClient(destChain)

		const daiAsset = this.configService.getDaiAsset(destChain)
		const usdtAsset = this.configService.getUsdtAsset(destChain)
		const usdcAsset = this.configService.getUsdcAsset(destChain)
		const daiDecimals = await contractService.getTokenDecimals(daiAsset, destChain)
		const usdtDecimals = await contractService.getTokenDecimals(usdtAsset, destChain)
		const usdcDecimals = await contractService.getTokenDecimals(usdcAsset, destChain)

		for (const token of order.outputs) {
			const tokenAddress = bytes32ToBytes20(token.token)
			const { nativeTokenBalance, daiBalance, usdcBalance, usdtBalance } =
				await contractService.getFillerBalanceUSD(order, destChain)

			// Get current balance of the required token
			const currentBalance =
				tokenAddress == daiAsset
					? daiBalance
					: tokenAddress == usdtAsset
						? usdtBalance
						: tokenAddress == usdcAsset
							? usdcBalance
							: nativeTokenBalance

			// Calculate how much more we need (in actual uint256 with decimals)
			const balanceNeeded = token.amount > currentBalance ? token.amount - currentBalance : BigInt(0)

			if (balanceNeeded > BigInt(0)) {
				// Convert all balances to the same unit (18 decimals) for comparison
				const normalizedBalances = {
					dai: daiBalance / BigInt(10 ** daiDecimals),
					usdt: usdtBalance / BigInt(10 ** usdtDecimals),
					usdc: usdcBalance / BigInt(10 ** usdcDecimals),
					native: nativeTokenBalance / BigInt(10 ** 18),
				}

				// Sort balances in descending order
				const sortedBalances = Object.entries(normalizedBalances).sort(([, a], [, b]) => Number(b - a))

				// Try to fulfill the requirement using the highest balance first
				let remainingNeeded = balanceNeeded
				for (const [tokenType, normalizedBalance] of sortedBalances) {
					if (remainingNeeded <= BigInt(0)) break

					// Skip if this is the same token we're trying to get
					if (
						(tokenType === "dai" && tokenAddress === daiAsset) ||
						(tokenType === "usdt" && tokenAddress === usdtAsset) ||
						(tokenType === "usdc" && tokenAddress === usdcAsset) ||
						(tokenType === "native" && tokenAddress === ADDRESS_ZERO)
					) {
						continue
					}

					// Get the actual balance with decimals
					const actualBalance =
						tokenType === "dai"
							? daiBalance
							: tokenType === "usdt"
								? usdtBalance
								: tokenType === "usdc"
									? usdcBalance
									: nativeTokenBalance

					// Calculate how much we can swap from this token (in actual uint256 with decimals)
					const swapAmount = actualBalance > remainingNeeded ? remainingNeeded : actualBalance

					if (swapAmount > BigInt(0)) {
						const tokenToSwap =
							tokenType === "dai"
								? daiAsset
								: tokenType === "usdt"
									? usdtAsset
									: tokenType === "usdc"
										? usdcAsset
										: ADDRESS_ZERO

						const amountsIn = await destClient.readContract({
							address: this.configService.getUniswapRouterV2Address(destChain),
							abi: UNISWAP_ROUTER_V2_ABI,
							functionName: "getAmountsIn",
							args: [swapAmount, [tokenToSwap, tokenAddress]],
						})

						const amountIn = amountsIn[0]

						const approveData = encodeFunctionData({
							abi: ERC20_ABI,
							functionName: "approve",
							args: [this.configService.getUniswapRouterV2Address(destChain), amountIn],
						})

						const approveCall = {
							to: tokenToSwap,
							data: approveData,
							value: BigInt(0),
						}

						const swapData = encodeFunctionData({
							abi: UNISWAP_ROUTER_V2_ABI,
							functionName: "swapTokensForExactTokens",
							args: [
								swapAmount,
								amountIn,
								[tokenToSwap, tokenAddress],
								fillerWalletAddress,
								order.deadline,
							],
						})

						const call = {
							to: this.configService.getUniswapRouterV2Address(destChain),
							data: swapData,
							value: BigInt(0),
						}

						try {
							const { results } = await destClient.simulateCalls({
								account: fillerWalletAddress,
								calls: [approveCall, call],
							})

							const operationGasEstimate = results.reduce(
								(acc, result) => acc + result.gasUsed,
								BigInt(0),
							)

							calls.push(approveCall, call)
							totalGasEstimate += operationGasEstimate
							remainingNeeded -= swapAmount
						} catch (simulationError) {
							console.error(`Swap simulation failed for ${tokenType}:`, simulationError)
							continue
						}
					}
				}

				// If we still need more tokens after trying all balances
				if (remainingNeeded > BigInt(0)) {
					throw new Error(`Insufficient balance to fulfill token requirement for ${tokenAddress}`)
				}
			}
		}

		// Cache the results
		cacheService.setSwapOperations(
			order.id!,
			calls.map((call) => ({
				to: call.to,
				data: call.data,
				value: call.value.toString(),
			})),
			totalGasEstimate,
		)

		return { calls, totalGasEstimate }
	}
}
