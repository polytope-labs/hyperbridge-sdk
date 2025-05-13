import { ChainConfigService, ChainClientManager, ContractInteractionService } from "@/services"
import {
	bytes32ToBytes20,
	constructRedeemEscrowRequestBody,
	estimateGasForPost,
	ExecutionResult,
	FillOptions,
	HexString,
	IPostRequest,
	Order,
} from "hyperbridge-sdk"
import { FillerStrategy } from "./base"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { encodeFunctionData, maxUint256 } from "viem"
import { erc7821Actions } from "viem/experimental"
import { UNISWAP_ROUTER_V2_ABI } from "@/config/abis/UniswapRouterV2"

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
			const nativeTokenPriceUsd = await this.contractService.getNativeTokenPriceUsd(order)

			const relayerFeeEth = postGas + (postGas * BigInt(200)) / BigInt(10000)

			const protocolFeeUSD = await this.contractService.getProtocolFeeUSD(order, relayerFeeEth)

			const totalGasWei = fillGas + relayerFeeEth

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

			const operations = await this.contractService.calculateSwapOperations(order, order.destChain)

			const postRequest: IPostRequest = {
				source: order.destChain,
				dest: order.sourceChain,
				body: constructRedeemEscrowRequestBody(order, privateKeyToAddress(this.privateKey)),
				timeoutTimestamp: 0n,
				nonce: await this.contractService.getHostNonce(order.sourceChain),
				from: this.configService.getIntentGatewayAddress(order.sourceChain),
				to: this.configService.getIntentGatewayAddress(order.destChain),
			}

			const postGasEstimate = await estimateGasForPost({
				postRequest: postRequest,
				sourceClient: this.clientManager.getPublicClient(order.sourceChain) as any,
				hostLatestStateMachineHeight: await this.contractService.getHostLatestStateMachineHeight(),
				hostAddress: this.configService.getHostAddress(order.sourceChain),
			})
			const fillOptions: FillOptions = {
				relayerFee: postGasEstimate + (postGasEstimate * BigInt(200)) / BigInt(10000),
			}

			await this.contractService.approveTokensIfNeeded(order)

			const fillOrderData = encodeFunctionData({
				abi: INTENT_GATEWAY_ABI,
				functionName: "fillOrder",
				args: [this.contractService.transformOrderForContract(order), fillOptions as any],
			})

			operations.push({
				calls: [
					{
						to: this.configService.getIntentGatewayAddress(order.destChain),
						data: fillOrderData,
						value: this.contractService.calculateRequiredEthValue(order.outputs),
					},
				],
			})

			try {
				// Simulating all calls together
				await destClient.simulateCalls({
					account: fillerWalletAddress,
					calls: operations.flatMap((op) => op.calls),
				})
			} catch (batchSimulationError) {
				console.error("Batch simulation failed:", batchSimulationError)
				throw new Error("Batch simulation failed")
			}

			const tx = await walletClient.extend(erc7821Actions()).executeBatches({
				address: fillerWalletAddress,
				batches: operations,
				account: privateKeyToAccount(this.privateKey),
				chain: destClient.chain,
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
}
