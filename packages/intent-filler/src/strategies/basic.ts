import { FillerStrategy } from "@/strategies/base"
import {
	Order,
	FillerConfig,
	ExecutionResult,
	HexString,
	FillOptions,
	PaymentInfo,
	DispatchPost,
	RequestKind,
	ChainConfig,
} from "@/types"
import {
	encodeFunctionData,
	encodePacked,
	getContract,
	maxUint256,
	parseEther,
	PublicClient,
	toHex,
	WalletClient,
} from "viem"
import {
	ADDRESS_ZERO,
	fetchTokenUsdPriceOnchain,
	generateRootWithProof,
	getOrderCommitment,
	getStateCommitmentFieldSlot,
} from "@/utils"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { addresses, assets, rpcUrls, chainIds, consensusStateIds } from "@/config/chain"
import { hexConcat } from "ethers/lib/utils"
import { IPostRequest } from "hyperbridge-sdk"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { viemClientFactory } from "@/config/client"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { HandlerV1_ABI } from "@/config/abis/HandlerV1"

export class BasicFiller implements FillerStrategy {
	name = "BasicFiller"
	private privateKey: HexString

	constructor(privateKey: HexString) {
		this.privateKey = privateKey
	}

	/**
	 * Determines if this strategy can fill the given order
	 * @param order The order to check
	 * @param config The filler configuration
	 * @returns True if the strategy can fill the order
	 */
	async canFill(order: Order, config: FillerConfig): Promise<boolean> {
		try {
			const destClient = this.getPublicClient(order.destChain)
			const sourceClient = this.getPublicClient(order.sourceChain)
			const currentBlock = await destClient.getBlockNumber()
			const deadline = BigInt(order.deadline)

			if (deadline < currentBlock) {
				console.debug(`Order expired at block ${deadline}, current block ${currentBlock}`)
				return false
			}

			const isAlreadyFilled = await this.checkIfOrderFilled(order, sourceClient)
			if (isAlreadyFilled) {
				console.debug(`Order is already filled`)
				return false
			}

			const hasEnoughTokens = await this.checkTokenBalances(order.outputs, destClient)
			if (!hasEnoughTokens) {
				console.debug(`Insufficient token balances for order`)
				return false
			}

			const orderValue = await this.calculateOrderValue(order, destClient)
			const requiredConfirmations = config.confirmationPolicy.getConfirmationBlocks(
				chainIds[order.destChain as keyof typeof chainIds]!,
				orderValue.toString(),
			)
			const sourceReceipt = await sourceClient.getTransactionReceipt({ hash: order.transactionHash })
			const sourceConfirmations = await sourceClient.getTransactionConfirmations({
				transactionReceipt: sourceReceipt,
			})
			if (sourceConfirmations < requiredConfirmations) {
				console.debug(
					`Insufficient confirmations for order, ${sourceConfirmations} confirmations, ${requiredConfirmations} required`,
				)
				return false
			}

			return true
		} catch (error) {
			console.error(`Error in canFill:`, error)
			return false
		}
	}

	/**
	 * Calculates the expected profitability of filling this order
	 * @param order The order to calculate profitability for
	 * @returns The expected profit in a normalized unit (usually USD value or ETH equivalent)
	 */
	async calculateProfitability(order: Order): Promise<number> {
		try {
			const destClient = this.getPublicClient(order.destChain)
			const sourceClient = this.getPublicClient(order.sourceChain)

			const gasEstimateForFill = await this.estimateGasForFill(order, destClient)

			const ethPriceUsd = await this.getEthPriceUsd(order, destClient)

			const relayerFeeEth = parseEther("0.001") // Fixed fee in ETH, converted to wei

			// Get the HyperBridge protocol fee
			const protocolFeeEth = await this.getProtocolFeeEth(
				order,
				destClient,
				relayerFeeEth,
				privateKeyToAddress(this.privateKey),
			)

			// Estimate the gas for handling POST requests in the source chain
			const postGasEstimate = await this.estimateGasForPost(order, { destClient, sourceClient })

			const totalCostUsd =
				(gasEstimateForFill + relayerFeeEth + protocolFeeEth + postGasEstimate) * BigInt(ethPriceUsd)

			// Convert order fees from DAI to USD
			const orderFeesUsd = order.fees / BigInt(10 ** 18)

			return orderFeesUsd > totalCostUsd ? Number(orderFeesUsd - totalCostUsd) : 0
		} catch (error) {
			console.error(`Error calculating profitability:`, error)
			return -1 // Negative profitability signals an error
		}
	}

	/**
	 * Executes the order fill
	 * @param order The order to fill
	 * @returns The execution result
	 */
	async executeOrder(order: Order): Promise<ExecutionResult> {
		const startTime = Date.now()

		try {
			const destClient = this.getPublicClient(order.destChain)
			const walletClient = this.getWalletClient(order.destChain)
			const fillOptions: FillOptions = {
				relayerFee: parseEther("0.001"), // Hardcoded it for now
			}

			const ethValue = await this.calculateRequiredEthValue(order.outputs)

			await this.approveTokensIfNeeded(order, { publicClient: destClient, walletClient })

			const { request } = await destClient.simulateContract({
				abi: INTENT_GATEWAY_ABI,
				address: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
				functionName: "fillOrder",
				args: [this.transformOrderForContract(order), fillOptions as any],
				account: privateKeyToAccount(this.privateKey),
				value: ethValue,
			})

			const tx = await walletClient.writeContract(request)

			const receipt = await destClient.getTransactionReceipt({ hash: tx })

			const endTime = Date.now()
			const processingTimeMs = endTime - startTime

			return {
				success: true,
				txHash: receipt.transactionHash,
				gasUsed: receipt.gasUsed.toString(),
				gasPrice: receipt.effectiveGasPrice.toString(),
				confirmedAtBlock: Number(receipt.blockNumber),
				confirmedAt: new Date(),
				strategyUsed: this.name,
				processingTimeMs,
			}
		} catch (error) {
			console.error(`Error executing order:`, error)

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}

	// Helper methods

	/**
	 * Transforms the order object to match the contract's expected format
	 */
	private transformOrderForContract(order: Order) {
		return {
			sourceChain: toHex(order.sourceChain),
			destChain: toHex(order.destChain),
			fees: order.fees,
			callData: order.callData,
			deadline: order.deadline,
			nonce: order.nonce,
			inputs: order.inputs.map((input) => ({
				token: input.token,
				amount: input.amount,
			})),
			outputs: order.outputs.map((output) => ({
				token: output.token,
				amount: output.amount,
				beneficiary: output.beneficiary,
			})),
			user: order.user,
		}
	}

	private transformPostRequestForContract(postRequest: IPostRequest) {
		return {
			source: toHex(postRequest.source),
			dest: toHex(postRequest.dest),
			nonce: postRequest.nonce,
			from: postRequest.from,
			to: postRequest.to,
			timeoutTimestamp: postRequest.timeoutTimestamp,
			body: postRequest.body,
		}
	}

	/**
	 * Checks if an order is already filled by querying contract storage
	 */
	private async checkIfOrderFilled(order: Order, sourceClient: PublicClient): Promise<boolean> {
		try {
			const commitment = getOrderCommitment(order)
			const sourceClient = this.getPublicClient(order.sourceChain)

			const filledSlot = await sourceClient.readContract({
				abi: INTENT_GATEWAY_ABI,
				address: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
				functionName: "calculateCommitmentSlotHash",
				args: [commitment as HexString],
			})

			const filledStatus = await sourceClient.getStorageAt({
				address: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
				slot: filledSlot,
			})
			return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
		} catch (error) {
			console.error(`Error checking if order filled:`, error)
			// Default to assuming it's not filled if we can't check
			return false
		}
	}

	/**
	 * Checks if we have sufficient token balances to fill the order
	 */
	private async checkTokenBalances(outputs: PaymentInfo[], destClient: PublicClient): Promise<boolean> {
		try {
			let totalNativeTokenNeeded = BigInt(0)
			const fillerWalletAddress = privateKeyToAddress(this.privateKey)

			// Check all token balances
			for (const output of outputs) {
				const tokenAddress = output.token
				const amount = output.amount

				if (tokenAddress === ADDRESS_ZERO) {
					// Native token
					totalNativeTokenNeeded = totalNativeTokenNeeded + amount
				} else {
					// ERC20 token
					const tokenContract = getContract({
						address: tokenAddress,
						abi: ERC20_ABI,
						client: destClient,
					})

					const balance = await tokenContract.read.balanceOf([fillerWalletAddress])

					if (balance < amount) {
						console.debug(
							`Insufficient ${tokenAddress} balance. Have ${balance.toString()}, need ${amount.toString()}`,
						)
						return false
					}
				}
			}

			// Check if we have enough native token
			if (totalNativeTokenNeeded > 0n) {
				const nativeBalance = await destClient.getBalance({ address: fillerWalletAddress })

				// Add some buffer for gas
				const withGasBuffer = totalNativeTokenNeeded + BigInt(0.001 * 10 ** 18) // 0.001 ETH buffer for gas

				if (BigInt(nativeBalance.toString()) < withGasBuffer) {
					console.debug(
						`Insufficient native token balance. Have ${nativeBalance.toString()}, need ${withGasBuffer.toString()}`,
					)
					return false
				}
			}

			return true
		} catch (error) {
			console.error(`Error checking token balances:`, error)
			return false
		}
	}

	/**
	 * Calculates the total order value for confirmation policy
	 */
	private async calculateOrderValue(order: Order, client: PublicClient): Promise<BigInt> {
		let totalUSDValue = BigInt(0)

		for (const input of order.inputs) {
			const tokenUsdPrice = await fetchTokenUsdPriceOnchain(
				input.token,
				client,
				addresses.UniswapV2Router[order.destChain as keyof typeof addresses.UniswapV2Router]!,
				assets[order.destChain as keyof typeof assets].WETH,
				assets[order.destChain as keyof typeof assets].DAI,
			)

			totalUSDValue = totalUSDValue + BigInt(input.amount * BigInt(tokenUsdPrice))
		}

		return totalUSDValue
	}

	/**
	 * Estimates gas for filling an order
	 */
	private async estimateGasForFill(order: Order, destClient: PublicClient): Promise<bigint> {
		try {
			const fillOptions: FillOptions = {
				relayerFee: parseEther("0.001"),
			}

			const ethValue = await this.calculateRequiredEthValue(order.outputs)

			const gas = await destClient.estimateContractGas({
				abi: INTENT_GATEWAY_ABI,
				address: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
				functionName: "fillOrder",
				args: [this.transformOrderForContract(order), fillOptions as any],
				account: privateKeyToAccount(this.privateKey),
				value: ethValue,
			})

			return gas
		} catch (error) {
			console.error(`Error estimating gas:`, error)
			// Return a conservative estimate if we can't calculate precisely
			return BigInt(500000)
		}
	}

	/**
	 * Gets the current ETH price in USD
	 */
	private async getEthPriceUsd(order: Order, destClient: PublicClient): Promise<number> {
		const ethPriceUsd = await fetchTokenUsdPriceOnchain(
			assets[order.destChain as keyof typeof assets].WETH,
			destClient,
			addresses.UniswapV2Router[order.destChain as keyof typeof addresses.UniswapV2Router]!,
			assets[order.destChain as keyof typeof assets].WETH,
			assets[order.destChain as keyof typeof assets].DAI,
		)

		return ethPriceUsd
	}

	/**
	 * Gets the HyperBridge protocol fee in ETH
	 */
	private async getProtocolFeeEth(
		order: Order,
		destClient: PublicClient,
		relayerFee: bigint,
		intentFillerAddr: HexString,
	): Promise<bigint> {
		const requestBody = this.constructRedeemEscrowRequestBody(order)

		const dispatchPost: DispatchPost = {
			dest: toHex(order.sourceChain),
			to: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
			body: requestBody,
			timeout: 0n,
			fee: relayerFee,
			payer: intentFillerAddr,
		}

		const protocolFeeEth = await destClient.readContract({
			abi: INTENT_GATEWAY_ABI,
			address: addresses.IntentGateway[order.destChain as keyof typeof addresses.IntentGateway]!,
			functionName: "quoteNative",
			args: [dispatchPost as any],
		})

		return protocolFeeEth
	}

	/**
	 * Constructs the redeem escrow request body
	 */
	private constructRedeemEscrowRequestBody(order: Order): HexString {
		const wallet = privateKeyToAddress(this.privateKey)
		const commitment = getOrderCommitment(order)

		// RequestKind.RedeemEscrow is 0 as defined in the contract
		const requestKind = encodePacked(["uint8"], [RequestKind.RedeemEscrow])

		const requestBody = encodePacked(
			["bytes32", "tuple(bytes32 token, uint256 amount)[]", "bytes32"],
			[commitment as HexString, order.inputs, wallet],
		)

		return hexConcat([requestKind, requestBody]) as HexString
	}

	/**
	 * Estimates gas for handling POST requests in the source chain
	 */
	private async estimateGasForPost(
		order: Order,
		clients: { sourceClient: PublicClient; destClient: PublicClient },
	): Promise<bigint> {
		const postRequest: IPostRequest = {
			source: order.destChain,
			dest: order.sourceChain,
			body: this.constructRedeemEscrowRequestBody(order),
			timeoutTimestamp: 0n,
			nonce: await this.getHostNonce(clients.destClient, order.destChain),
			from: addresses.IntentGateway[order.destChain as keyof typeof addresses.IntentGateway]!,
			to: addresses.IntentGateway[order.sourceChain as keyof typeof addresses.IntentGateway]!,
		}

		const { root, proof } = generateRootWithProof(postRequest)
		const latestStateMachineHeight = await this.getHostLatestStateMachineHeight(order.destChain)
		const overlayRootSlot = getStateCommitmentFieldSlot(
			BigInt(Number.parseInt(order.destChain.split("-")[1])),
			latestStateMachineHeight,
			1, // For overlayRoot
		)

		const params = {
			height: {
				stateMachineId: BigInt(Number.parseInt(order.destChain.split("-")[1])),
				height: latestStateMachineHeight,
			},
			multiproof: proof,
			leafCount: 100n,
		}

		const gas = await clients.sourceClient.estimateContractGas({
			address: addresses.Handler[order.sourceChain as keyof typeof addresses.Handler]!,
			abi: HandlerV1_ABI,
			functionName: "handlePostRequests",
			args: [
				addresses.Host[order.sourceChain as keyof typeof addresses.Host]!,
				{
					proof: params,
					requests: [
						{
							request: this.transformPostRequestForContract(postRequest),
							index: 0n,
							kIndex: 0n,
						},
					],
				},
			],
			stateOverride: [
				{
					address: addresses.Host[order.sourceChain as keyof typeof addresses.Host]!,
					stateDiff: [
						{
							slot: overlayRootSlot,
							value: root,
						},
					],
				},
			],
		})

		return gas
	}

	/**
	 * Gets the decimals for a token
	 */
	private async getTokenDecimals(tokenAddress: string, client: PublicClient): Promise<number> {
		if (tokenAddress === "0x0000000000000000000000000000000000000000") {
			return 18 // Native token (ETH, MATIC, etc.)
		}

		try {
			const decimals = await client.readContract({
				address: tokenAddress as HexString,
				abi: ERC20_ABI,
				functionName: "decimals",
			})

			return decimals
		} catch (error) {
			console.warn(`Error getting token decimals, defaulting to 18:`, error)
			return 18 // Default to 18 if we can't determine
		}
	}

	/**
	 * Calculates the ETH value to send with the transaction
	 */
	private calculateRequiredEthValue(outputs: any[]): bigint {
		let totalEthValue = 0n

		for (const output of outputs) {
			if (output.token === "0x0000000000000000000000000000000000000000") {
				// Native token output
				totalEthValue = totalEthValue + output.amount
			}
		}

		return totalEthValue
	}

	/**
	 * Approves ERC20 tokens for the contract if needed
	 */
	private async approveTokensIfNeeded(
		order: Order,
		clients: { publicClient: PublicClient; walletClient: WalletClient },
	): Promise<void> {
		const uniqueTokens = new Set<string>()
		const wallet = privateKeyToAccount(this.privateKey)
		const outputs = order.outputs
		const intentGateway = addresses.IntentGateway[order.destChain as keyof typeof addresses.IntentGateway]!

		// Collect unique ERC20 tokens
		for (const output of outputs) {
			if (output.token !== "0x0000000000000000000000000000000000000000") {
				uniqueTokens.add(output.token)
			}
		}

		// Approve each token
		for (const tokenAddress of uniqueTokens) {
			const currentAllowance = await clients.publicClient.readContract({
				abi: ERC20_ABI,
				address: tokenAddress as HexString,
				functionName: "allowance",
				args: [wallet.address, intentGateway],
			})

			// If allowance is too low, approve a very large amount
			if (currentAllowance < maxUint256) {
				console.log(`Approving ${tokenAddress} for the contract`)

				const request = await clients.publicClient.simulateContract({
					abi: ERC20_ABI,
					address: tokenAddress as HexString,
					functionName: "approve",
					args: [intentGateway, maxUint256],
					account: wallet,
				})

				const tx = await clients.walletClient.writeContract(request.request)
				console.log(`Approval confirmed for ${tokenAddress}`)
			}
		}
	}

	private getPublicClient(chain: string): PublicClient {
		const config: ChainConfig = {
			chainId: chainIds[chain as keyof typeof chainIds],
			rpcUrl: rpcUrls[chain as keyof typeof chainIds],
			intentGatewayAddress: addresses.IntentGateway[chain as keyof typeof chainIds]!,
		}

		return viemClientFactory.getPublicClient(config)
	}

	private getWalletClient(chain: string): WalletClient {
		const config: ChainConfig = {
			chainId: chainIds[chain as keyof typeof chainIds],
			rpcUrl: rpcUrls[chain as keyof typeof chainIds],
			intentGatewayAddress: addresses.IntentGateway[chain as keyof typeof chainIds]!,
		}

		return viemClientFactory.getWalletClient(config, this.privateKey)
	}

	private async getHostNonce(client: PublicClient, chain: string): Promise<bigint> {
		const nonce = await client.readContract({
			abi: EVM_HOST,
			address: addresses.Host[chain as keyof typeof addresses.Host]!,
			functionName: "nonce",
		})

		return nonce
	}

	private async getHostLatestStateMachineHeight(chain: String): Promise<bigint> {
		const wsProvider = new WsProvider(process.env.HYPERBRIDGE_GARGANTUA!)
		const api = await ApiPromise.create({ provider: wsProvider })
		await api.connect()
		const latestHeight = await api.query.ismp.latestStateMachineHeight({
			stateId: { Evm: chainIds[chain as keyof typeof chainIds] },
			consensusStateId: toHex(consensusStateIds[chain as keyof typeof consensusStateIds]),
		})
		await api.disconnect()
		return BigInt(latestHeight.toString())
	}
}
