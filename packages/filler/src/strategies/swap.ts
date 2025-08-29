import { ChainClientManager, ContractInteractionService } from "@/services"
import {
	ADDRESS_ZERO,
	bytes32ToBytes20,
	ChainConfigService,
	ExecutionResult,
	FillOptions,
	HexString,
	Order,
	fetchTokenUsdPrice,
} from "@hyperbridge/sdk"
import { FillerStrategy } from "./base"
import { privateKeyToAddress } from "viem/accounts"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { encodeAbiParameters, encodeFunctionData, encodePacked, maxUint256, PublicClient } from "viem"
import { BATCH_EXECUTOR_ABI } from "@/config/abis/BatchExecutor"
import { UNISWAP_ROUTER_V2_ABI } from "@/config/abis/UniswapRouterV2"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { UNIVERSAL_ROUTER_ABI } from "@/config/abis/UniversalRouter"
import { UNISWAP_V2_FACTORY_ABI } from "@/config/abis/UniswapV2Factory"
import { UNISWAP_V3_FACTORY_ABI } from "@/config/abis/UniswapV3Factory"
import { UNISWAP_V3_POOL_ABI } from "@/config/abis/UniswapV3Pool"
import { UNISWAP_V3_QUOTER_V2_ABI } from "@/config/abis/UniswapV3QuoterV2"
import { UNISWAP_V4_QUOTER_ABI } from "@/config/abis/UniswapV4Quoter"
import { UNISWAP_V4_POOL_MANAGER_ABI } from "@/config/abis/UniswapV4PoolManager"

export class StableSwapFiller implements FillerStrategy {
	name = "StableSwapFiller"
	private privateKey: HexString
	private clientManager: ChainClientManager
	private contractService: ContractInteractionService
	private configService: ChainConfigService

	constructor(privateKey: HexString) {
		this.privateKey = privateKey
		this.configService = new ChainConfigService()
		this.clientManager = new ChainClientManager(privateKey)
		this.contractService = new ContractInteractionService(this.clientManager, privateKey)
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

			const fillerBalanceUsd = await this.contractService.getFillerBalanceUSD(order.destChain)

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
			const { fillGas, relayerFeeInFeeToken } = await this.contractService.estimateGasFillPost(order)
			const { totalGasEstimate: swapGasEstimate } = await this.calculateSwapOperations(order)
			const protocolFeeInFeeToken = (await this.contractService.quote(order)) + relayerFeeInFeeToken
			const { decimals: destFeeTokenDecimals } = await this.contractService.getFeeTokenWithDecimals(
				order.destChain,
			)

			const gasEstimateExcludingRelayerFee = fillGas + swapGasEstimate
			const totalGasEstimateInFeeToken =
				(await this.contractService.convertGasToFeeToken(
					gasEstimateExcludingRelayerFee,
					order.destChain,
					destFeeTokenDecimals,
				)) +
				protocolFeeInFeeToken +
				relayerFeeInFeeToken

			const { outputUsdValue, inputUsdValue } = await this.contractService.getTokenUsdValue(order)
			const orderFeeInUsd = (order.fees * BigInt(10 ** destFeeTokenDecimals)) / BigInt(10 ** 18)
			const totalGasEstimateInUsd =
				(totalGasEstimateInFeeToken * BigInt(10 ** destFeeTokenDecimals)) / BigInt(10 ** 18)

			const toReceive = inputUsdValue + orderFeeInUsd
			const toPay = outputUsdValue + totalGasEstimateInUsd

			const profit = toReceive > toPay ? toReceive - toPay : BigInt(0)

			// Log for debugging
			console.log({
				orderFees: order.fees.toString(),
				totalGasEstimateInFeeToken: totalGasEstimateInFeeToken.toString(),
				profitable: profit > 0,
				profitUsd: profit.toString(),
			})
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

			const { calls } = await this.calculateSwapOperations(order)

			const { relayerFeeInFeeToken } = await this.contractService.estimateGasFillPost(order)
			const fillOptions: FillOptions = {
				relayerFee: relayerFeeInFeeToken,
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
	): Promise<{ calls: { to: HexString; data: HexString; value: bigint }[]; totalGasEstimate: bigint }> {
		// Check cache first
		const cachedOperations = this.contractService.cacheService.getSwapOperations(order.id!)
		if (cachedOperations) {
			console.log(`Using cached swap operations for order ${order.id}`)
			return this.formatCachedOperations(cachedOperations)
		}

		const context = await this.initializeSwapContextAndRequirements(order)

		const { calls, totalGasEstimate } = await this.generateAllSwapOperations(context)

		this.cacheSwapOperations(order.id!, calls, totalGasEstimate)
		return { calls, totalGasEstimate }
	}

	// Initialize context and calculate all token requirements in one go
	private async initializeSwapContextAndRequirements(order: Order): Promise<SwapContextWithRequirements> {
		const destChain = order.destChain
		const contractService = this.contractService
		const fillerWalletAddress = privateKeyToAddress(this.privateKey)
		const destClient = this.clientManager.getPublicClient(destChain)

		const daiAsset = this.configService.getDaiAsset(destChain)
		const usdtAsset = this.configService.getUsdtAsset(destChain)
		const usdcAsset = this.configService.getUsdcAsset(destChain)
		const wethAsset = this.configService.getWrappedNativeAssetWithDecimals(destChain).asset

		const [daiDecimals, usdtDecimals, usdcDecimals, balances] = await Promise.all([
			contractService.getTokenDecimals(daiAsset, destChain),
			contractService.getTokenDecimals(usdtAsset, destChain),
			contractService.getTokenDecimals(usdcAsset, destChain),
			contractService.getFillerBalanceUSD(destChain),
		])

		const assets = { daiAsset, usdtAsset, usdcAsset, wethAsset }
		const decimals = { daiDecimals, usdtDecimals, usdcDecimals }
		const initialBalances = {
			dai: balances.daiBalance,
			usdt: balances.usdtBalance,
			usdc: balances.usdcBalance,
			native: balances.nativeTokenBalance,
		}

		// Calculate token requirements
		const tokenRequirements: TokenBalances = {
			dai: BigInt(0),
			usdt: BigInt(0),
			usdc: BigInt(0),
			native: BigInt(0),
		}

		for (const token of order.outputs) {
			const tokenAddress = bytes32ToBytes20(token.token)
			if (tokenAddress === assets.daiAsset) {
				tokenRequirements.dai += token.amount
			} else if (tokenAddress === assets.usdtAsset) {
				tokenRequirements.usdt += token.amount
			} else if (tokenAddress === assets.usdcAsset) {
				tokenRequirements.usdc += token.amount
			} else if (tokenAddress === ADDRESS_ZERO) {
				tokenRequirements.native += token.amount
			}
		}

		// Calculate remaining balances and shortfalls
		const remainingBalances: TokenBalances = {
			dai: initialBalances.dai - tokenRequirements.dai,
			usdt: initialBalances.usdt - tokenRequirements.usdt,
			usdc: initialBalances.usdc - tokenRequirements.usdc,
			native: initialBalances.native - tokenRequirements.native,
		}

		const shortfalls: TokenBalances = {
			dai: tokenRequirements.dai > initialBalances.dai ? tokenRequirements.dai - initialBalances.dai : BigInt(0),
			usdt:
				tokenRequirements.usdt > initialBalances.usdt
					? tokenRequirements.usdt - initialBalances.usdt
					: BigInt(0),
			usdc:
				tokenRequirements.usdc > initialBalances.usdc
					? tokenRequirements.usdc - initialBalances.usdc
					: BigInt(0),
			native:
				tokenRequirements.native > initialBalances.native
					? tokenRequirements.native - initialBalances.native
					: BigInt(0),
		}

		return {
			contractService,
			fillerWalletAddress,
			destClient,
			destChain,
			assets,
			decimals,
			initialBalances,
			remainingBalances,
			shortfalls,
			universalRouterAddress: this.configService.getUniversalRouterAddress(destChain),
		}
	}

	// Generate all swap operations for all shortfalls
	private async generateAllSwapOperations(
		context: SwapContextWithRequirements,
	): Promise<{ calls: { to: HexString; data: HexString; value: bigint }[]; totalGasEstimate: bigint }> {
		const calls: { to: HexString; data: HexString; value: bigint }[] = []
		let totalGasEstimate = BigInt(0)

		const shortfallEntries = (Object.entries(context.shortfalls) as [TokenType, bigint][]).filter(
			([, amount]) => amount > BigInt(0),
		)

		for (const [tokenType, shortfallAmount] of shortfallEntries) {
			let remainingNeeded = shortfallAmount
			const targetTokenAddress = this.getTokenAddress(tokenType, context.assets)

			// Get available balances sorted by largest first
			const availableBalances = (Object.entries(context.remainingBalances) as [TokenType, bigint][])
				.filter(([type]) => type !== tokenType)
				.map(([type, balance]) => {
					const decimals =
						type === "dai"
							? context.decimals.daiDecimals
							: type === "usdt"
								? context.decimals.usdtDecimals
								: type === "usdc"
									? context.decimals.usdcDecimals
									: 18
					return {
						type,
						balance,
						normalizedBalance: balance / BigInt(10 ** decimals),
					}
				})
				.filter(({ balance }) => balance > BigInt(0))
				.sort((a, b) => Number(b.normalizedBalance - a.normalizedBalance))

			// Process each available balance until shortfall is covered
			for (const { type: sourceType, balance: sourceBalance } of availableBalances) {
				if (remainingNeeded <= BigInt(0)) break

				const sourceTokenAddress = this.getTokenAddress(sourceType, context.assets)
				const maxSwappableAmount = sourceBalance > remainingNeeded ? remainingNeeded : sourceBalance

				if (maxSwappableAmount <= BigInt(0)) continue

				// Get best protocol - use actual token addresses for quotes
				let bestProtocol: BestProtocol | null = null
				try {
					bestProtocol = await this.findBestProtocol(
						sourceTokenAddress,
						targetTokenAddress,
						maxSwappableAmount,
						context.destChain,
					)
				} catch (error) {
					console.error(
						`Error finding best protocol for swap ${sourceTokenAddress} -> ${targetTokenAddress}:`,
						error,
					)
					continue
				}

				if (bestProtocol.protocol === null || bestProtocol.amountIn > sourceBalance) {
					continue
				}

				// Generate swap calls
				const swapCalls = await this.generateSwapCallsForSingleSwap(
					sourceTokenAddress,
					targetTokenAddress,
					bestProtocol,
					maxSwappableAmount,
					context,
				)

				// Simulate and validate
				const gasEstimate = await this.simulateSwapCalls(swapCalls, context)
				if (gasEstimate === null) continue

				console.log(
					`Using ${bestProtocol.protocol.toUpperCase()} for swap ${sourceTokenAddress} -> ${targetTokenAddress}, amountIn: ${bestProtocol.amountIn}${bestProtocol.fee ? `, fee: ${bestProtocol.fee}` : ""}`,
				)

				calls.push(...swapCalls)
				totalGasEstimate += gasEstimate
				remainingNeeded -= maxSwappableAmount

				// Update remaining balance
				switch (sourceType) {
					case "dai":
						context.remainingBalances.dai -= bestProtocol.amountIn
						break
					case "usdt":
						context.remainingBalances.usdt -= bestProtocol.amountIn
						break
					case "usdc":
						context.remainingBalances.usdc -= bestProtocol.amountIn
						break
					case "native":
						context.remainingBalances.native -= bestProtocol.amountIn
						break
				}
			}

			if (remainingNeeded > BigInt(0)) {
				throw new Error(
					`Insufficient balance to fulfill token requirement. Need ${remainingNeeded} more of ${tokenType.toUpperCase()}`,
				)
			}
		}

		return { calls, totalGasEstimate }
	}

	// Generate contract calls for a single swap operation
	private async generateSwapCallsForSingleSwap(
		sourceTokenAddress: HexString,
		targetTokenAddress: HexString,
		bestProtocol: BestProtocol,
		maxSwappableAmount: bigint,
		context: SwapContextWithRequirements,
	): Promise<{ to: HexString; data: HexString; value: bigint }[]> {
		const calls: { to: HexString; data: HexString; value: bigint }[] = []

		// Handle source token preparation - V4 doesn't need wrapping!
		if (bestProtocol.protocol === "v4") {
			// V4 supports native tokens directly - no wrapping needed
			if (sourceTokenAddress !== ADDRESS_ZERO) {
				// Only transfer ERC20 tokens to router for V4
				calls.push({
					to: sourceTokenAddress,
					data: encodeFunctionData({
						abi: ERC20_ABI,
						functionName: "transfer",
						args: [context.universalRouterAddress, bestProtocol.amountIn],
					}),
					value: BigInt(0),
				})
			}
			// For native tokens, we'll pass the value directly in the swap call
		} else {
			// V2/V3 still need wrapping for native tokens
			if (sourceTokenAddress === ADDRESS_ZERO) {
				// Wrap native token
				calls.push({
					to: context.assets.wethAsset,
					data: encodeFunctionData({
						abi: [
							{ inputs: [], name: "deposit", outputs: [], stateMutability: "payable", type: "function" },
						],
						functionName: "deposit",
						args: [],
					}),
					value: bestProtocol.amountIn,
				})
				// Transfer WETH to router
				calls.push({
					to: context.assets.wethAsset,
					data: encodeFunctionData({
						abi: ERC20_ABI,
						functionName: "transfer",
						args: [context.universalRouterAddress, bestProtocol.amountIn],
					}),
					value: BigInt(0),
				})
			} else {
				// Transfer token to router
				calls.push({
					to: sourceTokenAddress,
					data: encodeFunctionData({
						abi: ERC20_ABI,
						functionName: "transfer",
						args: [context.universalRouterAddress, bestProtocol.amountIn],
					}),
					value: BigInt(0),
				})
			}
		}

		// Create swap call
		const V2_SWAP_EXACT_OUT = 0x09
		const V3_SWAP_EXACT_OUT = 0x01
		const V4_SWAP = 0x10

		const isPermit2 = false

		let commands: HexString
		let inputs: HexString[]

		if (bestProtocol.protocol === "v2") {
			const swapSourceAddress =
				sourceTokenAddress === ADDRESS_ZERO ? context.assets.wethAsset : sourceTokenAddress
			const swapTargetAddress =
				targetTokenAddress === ADDRESS_ZERO ? context.assets.wethAsset : targetTokenAddress

			const path = [swapSourceAddress, swapTargetAddress]
			commands = encodePacked(["uint8"], [V2_SWAP_EXACT_OUT])
			inputs = [
				encodeAbiParameters(
					[
						{ type: "address", name: "recipient" },
						{ type: "uint256", name: "amountOut" },
						{ type: "uint256", name: "amountInMax" },
						{ type: "address[]", name: "path" },
						{ type: "bool", name: "isPermit2" },
					],
					[context.fillerWalletAddress, maxSwappableAmount, bestProtocol.amountIn, path, isPermit2],
				),
			]
		} else if (bestProtocol.protocol === "v3") {
			const swapSourceAddress =
				sourceTokenAddress === ADDRESS_ZERO ? context.assets.wethAsset : sourceTokenAddress
			const swapTargetAddress =
				targetTokenAddress === ADDRESS_ZERO ? context.assets.wethAsset : targetTokenAddress

			const pathV3 = encodePacked(
				["address", "uint24", "address"],
				[swapSourceAddress, bestProtocol.fee!, swapTargetAddress],
			)
			commands = encodePacked(["uint8"], [V3_SWAP_EXACT_OUT])
			inputs = [
				encodeAbiParameters(
					[
						{ type: "address", name: "recipient" },
						{ type: "uint256", name: "amountOut" },
						{ type: "uint256", name: "amountInMax" },
						{ type: "bytes", name: "path" },
						{ type: "bool", name: "isPermit2" },
					],
					[context.fillerWalletAddress, maxSwappableAmount, bestProtocol.amountIn, pathV3, isPermit2],
				),
			]
		} else if (bestProtocol.protocol === "v4") {
			const currency0 = sourceTokenAddress < targetTokenAddress ? sourceTokenAddress : targetTokenAddress
			const currency1 = sourceTokenAddress < targetTokenAddress ? targetTokenAddress : sourceTokenAddress

			const poolKey = {
				currency0: currency0,
				currency1: currency1,
				fee: bestProtocol.fee!,
				tickSpacing: this.getTickSpacing(bestProtocol.fee!),
				hooks: ADDRESS_ZERO,
			}

			const zeroForOne = sourceTokenAddress === currency0

			const SWAP_EXACT_OUT_SINGLE = 0x08
			const SETTLE_ALL = 0x0c
			const TAKE_ALL = 0x0f

			const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_OUT_SINGLE, SETTLE_ALL, TAKE_ALL])

			const swapParams = encodeAbiParameters(
				[
					{
						type: "tuple",
						name: "ExactOutputSingleParams",
						components: [
							{
								type: "tuple",
								name: "poolKey",
								components: [
									{ type: "address", name: "currency0" },
									{ type: "address", name: "currency1" },
									{ type: "uint24", name: "fee" },
									{ type: "int24", name: "tickSpacing" },
									{ type: "address", name: "hooks" },
								],
							},
							{ type: "bool", name: "zeroForOne" },
							{ type: "uint128", name: "amountOut" },
							{ type: "uint128", name: "amountInMaximum" },
							{ type: "bytes", name: "hookData" },
						],
					},
				],
				[
					{
						poolKey,
						zeroForOne,
						amountOut: maxSwappableAmount,
						amountInMaximum: bestProtocol.amountIn,
						hookData: "0x",
					},
				],
			)

			const settleParams = encodeAbiParameters(
				[
					{ type: "address", name: "currency" },
					{ type: "uint128", name: "amount" },
				],
				[sourceTokenAddress, bestProtocol.amountIn],
			)

			const takeParams = encodeAbiParameters(
				[
					{ type: "address", name: "currency" },
					{ type: "uint128", name: "amount" },
				],
				[targetTokenAddress, maxSwappableAmount],
			)

			const params = [swapParams, settleParams, takeParams]

			commands = encodePacked(["uint8"], [V4_SWAP])
			inputs = [
				encodeAbiParameters(
					[
						{ type: "bytes", name: "actions" },
						{ type: "bytes[]", name: "params" },
					],
					[actions, params],
				),
			]
		} else {
			throw new Error("Invalid protocol type")
		}

		const deadline = (await context.destClient.getBlock()).timestamp + 120n

		const swapValue =
			bestProtocol.protocol === "v4" && sourceTokenAddress === ADDRESS_ZERO ? bestProtocol.amountIn : BigInt(0)

		calls.push({
			to: context.universalRouterAddress,
			data: encodeFunctionData({
				abi: UNIVERSAL_ROUTER_ABI,
				functionName: "execute",
				args: [commands, inputs, deadline],
			}),
			value: swapValue,
		})

		// Handle target token unwrapping - V4 doesn't need unwrapping for native output
		if (targetTokenAddress === ADDRESS_ZERO && bestProtocol.protocol !== "v4") {
			// Only V2/V3 need unwrapping since they use WETH
			calls.push({
				to: context.assets.wethAsset,
				data: encodeFunctionData({
					abi: [
						{
							inputs: [{ internalType: "uint256", name: "wad", type: "uint256" }],
							name: "withdraw",
							outputs: [],
							stateMutability: "nonpayable",
							type: "function",
						},
					],
					functionName: "withdraw",
					args: [maxSwappableAmount],
				}),
				value: BigInt(0),
			})
		}

		return calls
	}

	private getTokenAddress(tokenType: TokenType, assets: TokenAssets): HexString {
		switch (tokenType) {
			case "dai":
				return assets.daiAsset
			case "usdt":
				return assets.usdtAsset
			case "usdc":
				return assets.usdcAsset
			case "native":
				return ADDRESS_ZERO
			default:
				return ADDRESS_ZERO
		}
	}

	private getTickSpacing(fee: number): number {
		switch (fee) {
			case 100: // 0.01%
				return 1
			case 500: // 0.05%
				return 10
			case 3000: // 0.30%
				return 60
			case 10000: // 1.00%
				return 200
			default:
				return 60 // Default to medium
		}
	}

	private async simulateSwapCalls(
		calls: { to: HexString; data: HexString; value: bigint }[],
		context: SwapContextWithRequirements,
	): Promise<bigint | null> {
		try {
			const { results } = await context.destClient.simulateCalls({
				account: context.fillerWalletAddress,
				calls,
			})
			return results.reduce((acc: bigint, result: { gasUsed: bigint }) => acc + result.gasUsed, BigInt(0))
		} catch (error) {
			console.error("Swap simulation failed:", error)
			return null
		}
	}

	private formatCachedOperations(cachedOperations: {
		calls: { to: string; data: string; value: string }[]
		totalGasEstimate: bigint
	}): { calls: { to: HexString; data: HexString; value: bigint }[]; totalGasEstimate: bigint } {
		return {
			calls: cachedOperations.calls.map((call) => ({
				to: call.to as HexString,
				data: call.data as HexString,
				value: BigInt(call.value),
			})),
			totalGasEstimate: cachedOperations.totalGasEstimate,
		}
	}

	private cacheSwapOperations(
		orderId: string,
		calls: { to: HexString; data: HexString; value: bigint }[],
		totalGasEstimate: bigint,
	): void {
		this.contractService.cacheService.setSwapOperations(
			orderId,
			calls.map((call) => ({
				to: call.to,
				data: call.data,
				value: call.value.toString(),
			})),
			totalGasEstimate,
		)
	}

	// Returns true if candidate <= reference * (1 + thresholdBps/10000)
	private isWithinThreshold(candidate: bigint, reference: bigint, thresholdBps: bigint): boolean {
		const basisPoints = 10000n
		return candidate * basisPoints <= reference * (basisPoints + thresholdBps)
	}

	// Find whether uniswap v2, v3, or v4 is the best protocol to use based on the amountIn the filler has to pay
	async findBestProtocol(
		tokenIn: HexString,
		tokenOut: HexString,
		amountOut: bigint,
		destChain: string,
	): Promise<{
		protocol: "v2" | "v3" | "v4" | null
		amountIn: bigint
		fee?: number // For V3/V4
	}> {
		const destClient = this.clientManager.getPublicClient(destChain)
		let amountInV2 = maxUint256
		let amountInV3 = maxUint256
		let amountInV4 = maxUint256
		let bestV3Fee = 0
		let bestV4Fee = 0
		const commonFees = [500, 3000, 10000]

		const v2Router = this.configService.getUniswapRouterV2Address(destChain)
		const v2Factory = this.configService.getUniswapV2FactoryAddress(destChain)
		const v3Factory = this.configService.getUniswapV3FactoryAddress(destChain)
		const v3Quoter = this.configService.getUniswapV3QuoterAddress(destChain)
		const v4Quoter = this.configService.getUniswapV4QuoterAddress(destChain)

		// For V2/V3, convert native addresses to WETH for quotes
		const wethAsset = this.configService.getWrappedNativeAssetWithDecimals(destChain).asset
		const tokenInForQuote = tokenIn === ADDRESS_ZERO ? wethAsset : tokenIn
		const tokenOutForQuote = tokenOut === ADDRESS_ZERO ? wethAsset : tokenOut

		// V2 Protocol Check
		try {
			const v2PairExists = (await destClient.readContract({
				address: v2Factory,
				abi: UNISWAP_V2_FACTORY_ABI,
				functionName: "getPair",
				args: [tokenInForQuote, tokenOutForQuote],
			})) as HexString

			if (v2PairExists !== ADDRESS_ZERO) {
				const v2AmountIn = (await destClient.readContract({
					address: v2Router,
					abi: UNISWAP_ROUTER_V2_ABI,
					functionName: "getAmountsIn",
					args: [amountOut, [tokenInForQuote, tokenOutForQuote]],
				})) as bigint[]

				amountInV2 = v2AmountIn[0]
			}
		} catch (error) {
			console.warn("V2 quote failed:", error)
		}

		// V3 Protocol Check - Find the best pool with best quote
		let bestV3AmountIn = maxUint256

		for (const fee of commonFees) {
			try {
				const pool = await destClient.readContract({
					address: v3Factory,
					abi: UNISWAP_V3_FACTORY_ABI,
					functionName: "getPool",
					args: [tokenInForQuote, tokenOutForQuote, fee],
				})

				if (pool !== ADDRESS_ZERO) {
					const liquidity = await destClient.readContract({
						address: pool,
						abi: UNISWAP_V3_POOL_ABI,
						functionName: "liquidity",
					})

					if (liquidity > BigInt(0)) {
						// Use simulateContract for V3 quoter (handles revert-based returns)
						const quoteResult = (
							await destClient.simulateContract({
								address: v3Quoter,
								abi: UNISWAP_V3_QUOTER_V2_ABI,
								functionName: "quoteExactOutputSingle",
								args: [
									{
										tokenIn: tokenInForQuote,
										tokenOut: tokenOutForQuote,
										fee: fee,
										amount: amountOut,
										sqrtPriceLimitX96: BigInt(0),
									},
								],
							})
						).result as [bigint, bigint, number, bigint] // [amountIn, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]

						const amountIn = quoteResult[0]

						if (amountIn < bestV3AmountIn) {
							bestV3AmountIn = amountIn
							bestV3Fee = fee
						}
					}
				}
			} catch (error) {
				console.warn(`V3 quote failed for fee ${fee}, continuing to next fee tier`)
			}
		}

		amountInV3 = bestV3AmountIn

		// V4 Protocol Check - Find the best pool with best quote (uses native addresses directly)
		let bestV4AmountIn = maxUint256

		for (const fee of commonFees) {
			try {
				// Create pool key for V4 - can use native addresses directly
				const poolKey = {
					currency0: tokenIn < tokenOut ? tokenIn : tokenOut,
					currency1: tokenIn < tokenOut ? tokenOut : tokenIn,
					fee: fee,
					tickSpacing: this.getTickSpacing(fee),
					hooks: ADDRESS_ZERO, // No hooks
				}

				// Get quote from V4 quoter
				const quoteResult = (
					await destClient.simulateContract({
						address: v4Quoter,
						abi: UNISWAP_V4_QUOTER_ABI,
						functionName: "quoteExactOutputSingle",
						args: [
							{
								poolKey: poolKey,
								zeroForOne: tokenIn < tokenOut,
								exactAmount: amountOut,
								hookData: "0x", // Empty hook data
							},
						],
					})
				).result as [bigint, bigint] // [amountIn, gasEstimate]

				const amountIn = quoteResult[0]

				if (amountIn < bestV4AmountIn) {
					bestV4AmountIn = amountIn
					bestV4Fee = fee
				}
			} catch (error) {
				console.warn(`V4 quote failed for fee ${fee}, continuing to next fee tier`)
			}
		}

		amountInV4 = bestV4AmountIn

		if (amountInV2 === maxUint256 && amountInV3 === maxUint256 && amountInV4 === maxUint256) {
			// No liquidity in any protocol
			return {
				protocol: null,
				amountIn: maxUint256,
			}
		}

		// Prefer V4 when V4 is close to the best of V2/V3 (within thresholdBps)
		if (amountInV4 !== maxUint256) {
			const thresholdBps = 100n // 1%
			if (amountInV3 !== maxUint256 && this.isWithinThreshold(amountInV4, amountInV3, thresholdBps)) {
				return { protocol: "v4", amountIn: amountInV4, fee: bestV4Fee }
			}
			if (amountInV2 !== maxUint256 && this.isWithinThreshold(amountInV4, amountInV2, thresholdBps)) {
				return { protocol: "v4", amountIn: amountInV4, fee: bestV4Fee }
			}
		}

		const minAmount = [
			{ protocol: "v2" as const, amountIn: amountInV2 },
			{ protocol: "v3" as const, amountIn: amountInV3, fee: bestV3Fee },
			{ protocol: "v4" as const, amountIn: amountInV4, fee: bestV4Fee },
		].reduce((best, current) => (current.amountIn < best.amountIn ? current : best))

		if (minAmount.protocol === "v2") {
			return {
				protocol: "v2",
				amountIn: amountInV2,
			}
		} else if (minAmount.protocol === "v3") {
			return {
				protocol: "v3",
				amountIn: amountInV3,
				fee: bestV3Fee,
			}
		} else {
			return {
				protocol: "v4",
				amountIn: amountInV4,
				fee: bestV4Fee,
			}
		}
	}
}

interface TokenBalances {
	dai: bigint
	usdt: bigint
	usdc: bigint
	native: bigint
}

interface TokenAssets {
	daiAsset: HexString
	usdtAsset: HexString
	usdcAsset: HexString
	wethAsset: HexString
}

interface TokenDecimals {
	daiDecimals: number
	usdtDecimals: number
	usdcDecimals: number
}

interface SwapContext {
	contractService: ContractInteractionService
	fillerWalletAddress: HexString
	destClient: PublicClient
	destChain: string
	assets: TokenAssets
	decimals: TokenDecimals
	initialBalances: TokenBalances
	universalRouterAddress: HexString
}

interface SwapContextWithRequirements extends SwapContext {
	remainingBalances: TokenBalances
	shortfalls: TokenBalances
}

interface BestProtocol {
	protocol: "v2" | "v3" | "v4" | null
	amountIn: bigint
	fee?: number
}

type TokenType = keyof TokenBalances
