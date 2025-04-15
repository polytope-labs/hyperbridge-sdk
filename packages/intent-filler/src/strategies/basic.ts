import { FillerStrategy } from "@/strategies/base"
import { Order, FillerConfig, ExecutionResult, HexString, FillOptions, DispatchPost, RequestKind } from "@/types"
import { encodePacked, getContract, maxUint256, parseEther, PublicClient, toHex } from "viem"
import {
	fetchTokenUsdPriceOnchain,
	generateRootWithProof,
	getOrderCommitment,
	getStateCommitmentFieldSlot,
} from "@/utils"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { hexConcat } from "ethers/lib/utils"
import { IPostRequest } from "hyperbridge-sdk"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { HandlerV1_ABI } from "@/config/abis/HandlerV1"
import { ChainClientManager, ChainConfigService, ContractInteractionService } from "@/services"

export class BasicFiller implements FillerStrategy {
	name = "BasicFiller"
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
	 * Determines if this strategy can fill the given order
	 * @param order The order to check
	 * @param config The filler configuration
	 * @returns True if the strategy can fill the order
	 */
	async canFill(order: Order, config: FillerConfig): Promise<boolean> {
		try {
			const { destClient, sourceClient } = this.clientManager.getClientsForOrder(order)
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

			const hasEnoughTokens = await this.contractService.checkTokenBalances(order.outputs, order.destChain)
			if (!hasEnoughTokens) {
				console.debug(`Insufficient token balances for order`)
				return false
			}

			const orderValue = await this.calculateOrderValue(order, destClient)
			const requiredConfirmations = config.confirmationPolicy.getConfirmationBlocks(
				this.configService.getChainId(order.destChain),
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
			const { destClient, sourceClient } = this.clientManager.getClientsForOrder(order)

			const gasEstimateForFill = await this.estimateGasForFill(order, destClient)

			const ethPriceUsd = await this.getEthPriceUsd(order, destClient)

			const postGasEstimate = await this.estimateGasForPost(order, { destClient, sourceClient })

			const relayerFeeEth = postGasEstimate + (postGasEstimate * BigInt(2)) / BigInt(100)

			const protocolFeeEth = await this.getProtocolFeeEth(
				order,
				destClient,
				relayerFeeEth,
				privateKeyToAddress(this.privateKey),
			)

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
			const { destClient, sourceClient, walletClient } = this.clientManager.getClientsForOrder(order)
			const postGasEstimate = await this.estimateGasForPost(order, {
				sourceClient,
				destClient,
			})
			const fillOptions: FillOptions = {
				relayerFee: postGasEstimate + (postGasEstimate * BigInt(2)) / BigInt(100),
			}

			const ethValue = this.contractService.calculateRequiredEthValue(order.outputs)

			await this.contractService.approveTokensIfNeeded(order)

			const { request } = await destClient.simulateContract({
				abi: INTENT_GATEWAY_ABI,
				address: this.configService.getIntentGatewayAddress(order.sourceChain),
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
			const sourceClient = this.clientManager.getPublicClient(order.sourceChain)
			const intentGatewayAddress = this.configService.getIntentGatewayAddress(order.sourceChain)

			const filledSlot = await sourceClient.readContract({
				abi: INTENT_GATEWAY_ABI,
				address: intentGatewayAddress,
				functionName: "calculateCommitmentSlotHash",
				args: [commitment as HexString],
			})

			const filledStatus = await sourceClient.getStorageAt({
				address: intentGatewayAddress,
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
	 * Calculates the total order value for confirmation policy
	 */
	private async calculateOrderValue(order: Order, client: PublicClient): Promise<BigInt> {
		let totalUSDValue = BigInt(0)

		for (const input of order.inputs) {
			const tokenUsdPrice = await fetchTokenUsdPriceOnchain(
				input.token,
				client,
				this.configService.getUniswapV2RouterAddress(order.destChain),
				this.configService.getWethAsset(order.destChain),
				this.configService.getDaiAsset(order.destChain),
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

			const ethValue = this.contractService.calculateRequiredEthValue(order.outputs)

			const gas = await destClient.estimateContractGas({
				abi: INTENT_GATEWAY_ABI,
				address: this.configService.getIntentGatewayAddress(order.sourceChain),
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
			this.configService.getWethAsset(order.destChain),
			destClient,
			this.configService.getUniswapV2RouterAddress(order.destChain),
			this.configService.getWethAsset(order.destChain),
			this.configService.getDaiAsset(order.destChain),
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
			to: this.configService.getIntentGatewayAddress(order.sourceChain),
			body: requestBody,
			timeout: 0n,
			fee: relayerFee,
			payer: intentFillerAddr,
		}

		const protocolFeeEth = await destClient.readContract({
			abi: INTENT_GATEWAY_ABI,
			address: this.configService.getIntentGatewayAddress(order.destChain),
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
			from: this.configService.getIntentGatewayAddress(order.destChain),
			to: this.configService.getIntentGatewayAddress(order.sourceChain),
		}

		const { root, proof } = generateRootWithProof(postRequest)
		const latestStateMachineHeight = await this.getHostLatestStateMachineHeight(order.destChain)
		const overlayRootSlot = getStateCommitmentFieldSlot(
			BigInt(this.configService.getChainId(order.destChain)),
			latestStateMachineHeight,
			1, // For overlayRoot
		)

		const params = {
			height: {
				stateMachineId: BigInt(this.configService.getChainId(order.destChain)),
				height: latestStateMachineHeight,
			},
			multiproof: proof,
			leafCount: 100n,
		}

		const gas = await clients.sourceClient.estimateContractGas({
			address: this.configService.getHandlerAddress(order.sourceChain),
			abi: HandlerV1_ABI,
			functionName: "handlePostRequests",
			args: [
				this.configService.getHostAddress(order.sourceChain),
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
					address: this.configService.getHostAddress(order.sourceChain),
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

	private async getHostNonce(client: PublicClient, chain: string): Promise<bigint> {
		const nonce = await client.readContract({
			abi: EVM_HOST,
			address: this.configService.getHostAddress(chain),
			functionName: "nonce",
		})

		return nonce
	}

	private async getHostLatestStateMachineHeight(chain: string): Promise<bigint> {
		const wsProvider = new WsProvider(process.env.HYPERBRIDGE_GARGANTUA!)
		const api = await ApiPromise.create({ provider: wsProvider })
		await api.connect()
		const latestHeight = await api.query.ismp.latestStateMachineHeight({
			stateId: { Evm: this.configService.getChainId(chain) },
			consensusStateId: this.configService.getConsensusStateId(chain),
		})
		await api.disconnect()
		return BigInt(latestHeight.toString())
	}
}
