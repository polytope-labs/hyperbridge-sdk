import { FillerStrategy } from "@/strategies/base"
import { Order, FillerConfig, ExecutionResult, HexString, FillOptions } from "hyperbridge-sdk"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { privateKeyToAccount } from "viem/accounts"
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

			const hasEnoughTokens = await this.contractService.checkTokenBalances(order.outputs, order.destChain)
			if (!hasEnoughTokens) {
				console.debug(`Insufficient token balances for order`)
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
			const destClient = this.clientManager.getPublicClient(order.destChain)

			const gasEstimateForFill = await this.contractService.estimateGasForFill(order)

			const ethPriceUsd = await this.contractService.getEthPriceUsd(order, destClient)

			const postGasEstimate = await this.contractService.estimateGasForPost(order)

			const relayerFeeEth = postGasEstimate + (postGasEstimate * BigInt(2)) / BigInt(100)

			const protocolFeeEth = await this.contractService.getProtocolFeeEth(order, relayerFeeEth)

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
			const { destClient, walletClient } = this.clientManager.getClientsForOrder(order)
			const postGasEstimate = await this.contractService.estimateGasForPost(order)
			const fillOptions: FillOptions = {
				relayerFee: postGasEstimate + (postGasEstimate * BigInt(2)) / BigInt(100),
			}

			const ethValue = this.contractService.calculateRequiredEthValue(order.outputs)

			await this.contractService.approveTokensIfNeeded(order)

			const { request } = await destClient.simulateContract({
				abi: INTENT_GATEWAY_ABI,
				address: this.configService.getIntentGatewayAddress(order.sourceChain),
				functionName: "fillOrder",
				args: [this.contractService.transformOrderForContract(order), fillOptions as any],
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
}
