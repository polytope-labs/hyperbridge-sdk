import { FillerStrategy } from "@/strategies/base"
import {
	OrderV2,
	ExecutionResult,
	HexString,
	bytes32ToBytes20,
	FillOptionsV2,
	ADDRESS_ZERO,
	TokenInfoV2,
} from "@hyperbridge/sdk"
import { INTENT_GATEWAY_V2_ABI } from "@/config/abis/IntentGatewayV2"
import { privateKeyToAccount } from "viem/accounts"
import { ChainClientManager, ContractInteractionService } from "@/services"
import { FillerConfigService } from "@/services/FillerConfigService"
import { CacheService } from "@/services/CacheService"
import { compareDecimalValues } from "@/utils"
import { formatUnits } from "viem"
import { getLogger } from "@/services/Logger"

export class BasicFiller implements FillerStrategy {
	name = "BasicFiller"
	private privateKey: HexString
	private clientManager: ChainClientManager
	private contractService: ContractInteractionService
	private configService: FillerConfigService
	private logger = getLogger("basic-filler")

	constructor(privateKey: HexString, configService: FillerConfigService, sharedCacheService?: CacheService) {
		this.privateKey = privateKey
		this.configService = configService
		this.clientManager = new ChainClientManager(configService, privateKey)
		this.contractService = new ContractInteractionService(
			this.clientManager,
			privateKey,
			configService,
			sharedCacheService,
		)
	}

	/**
	 * Determines if this strategy can fill the given order
	 * @param order The order to check
	 * @param config The filler configuration
	 * @returns True if the strategy can fill the order
	 */
	async canFill(order: OrderV2): Promise<boolean> {
		try {
			return await this.validateOrderInputsOutputs(order)
		} catch (error) {
			this.logger.error({ err: error }, "Error in canFill")
			return false
		}
	}

	/**
	 * Calculates the USD value of the order's inputs, outputs, fees and compares
	 * what will the filler receive and what will the filler pay
	 * @param order The order to calculate the USD value for
	 * @returns The profit in USD (Number)
	 */
	async calculateProfitability(order: OrderV2): Promise<number> {
		try {
			const { totalCostInSourceFeeToken } = await this.contractService.estimateGasFillPost(order)
			const { decimals: sourceFeeTokenDecimals } = await this.contractService.getFeeTokenWithDecimals(
				order.source,
			)
			const { decimals: destFeeTokenDecimals } = await this.contractService.getFeeTokenWithDecimals(
				order.destination,
			)

			const profit = totalCostInSourceFeeToken > order.fees ? totalCostInSourceFeeToken - order.fees : 0n

			this.logger.info(
				{
					orderFeesUSD: formatUnits(order.fees, destFeeTokenDecimals),
					totalCostInSourceFeeTokenUSD: formatUnits(totalCostInSourceFeeToken, destFeeTokenDecimals),
					profitable: profit > 0,
					profitUSD: formatUnits(profit, sourceFeeTokenDecimals),
				},
				"Profitability evaluation",
			)
			return parseFloat(formatUnits(profit, destFeeTokenDecimals))
		} catch (error) {
			this.logger.error({ err: error }, "Error calculating profitability")
			return 0
		}
	}

	/**
	 * Executes the order fill
	 * @param order The order to fill
	 * @returns The execution result
	 */
	async executeOrder(order: OrderV2): Promise<ExecutionResult> {
		const startTime = Date.now()

		try {
			const { destClient, walletClient } = this.clientManager.getClientsForOrder(order)

			const { dispatchFee, nativeDispatchFee, callGasLimit } =
				await this.contractService.estimateGasFillPost(order)

			const fillOptions: FillOptionsV2 = {
				relayerFee: dispatchFee,
				nativeDispatchFee: nativeDispatchFee,
				outputs: order.output.assets,
			}

			// Add all eth values from the outputs
			const ethValue = order.output.assets.reduce((acc: bigint, output: TokenInfoV2) => {
				if (bytes32ToBytes20(output.token) === ADDRESS_ZERO) {
					return acc + output.amount
				}
				return acc
			}, 0n)

			await this.contractService.approveTokensIfNeeded(order)

			const tx = await walletClient
				.writeContract({
					abi: INTENT_GATEWAY_V2_ABI,
					address: this.configService.getIntentGatewayV2Address(order.destination),
					functionName: "fillOrder",
					args: [this.contractService.transformOrderForContract(order), fillOptions as any],
					account: privateKeyToAccount(this.privateKey),
					value: nativeDispatchFee !== 0n ? ethValue + nativeDispatchFee : ethValue,
					chain: walletClient.chain,
					gas: callGasLimit + (callGasLimit * 2500n) / 10000n,
				})
				.catch(async () => {
					return await walletClient.writeContract({
						abi: INTENT_GATEWAY_V2_ABI,
						address: this.configService.getIntentGatewayV2Address(order.destination),
						functionName: "fillOrder",
						args: [this.contractService.transformOrderForContract(order), fillOptions as any],
						account: privateKeyToAccount(this.privateKey),
						value: nativeDispatchFee !== 0n ? ethValue + nativeDispatchFee : ethValue,
						chain: walletClient.chain,
					})
				})

			const endTime = Date.now()
			const processingTimeMs = endTime - startTime

			const receipt = await destClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 })

			if (receipt.status !== "success") {
				this.logger.error({ txHash: receipt.transactionHash, status: receipt.status }, "Could not fill order")
				return {
					success: false,
					txHash: tx,
				}
			}

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
			this.logger.error({ err: error }, "Error executing order")

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}

	/**
	 * Validates that order inputs and outputs are valid for filling
	 * @param order The order to validate
	 * @returns True if the order inputs and outputs are valid
	 */
	async validateOrderInputsOutputs(order: OrderV2): Promise<boolean> {
		try {
			// Note: The inputs and output lengths may not match when running a solver
			// Todo: Revisit this
			if (order.inputs.length !== order.output.assets.length) {
				this.logger.debug(
					{ inputs: order.inputs.length, outputs: order.output.assets.length },
					"Order length mismatch",
				)
				return false
			}

			const getTokenType = (tokenAddress: string, chain: string): string | null => {
				tokenAddress = bytes32ToBytes20(tokenAddress).toLowerCase()
				const assets = {
					USDT: this.configService.getUsdtAsset(chain).toLowerCase(),
					USDC: this.configService.getUsdcAsset(chain).toLowerCase(),
				}
				const result =
					Object.keys(assets).find((type) => assets[type as keyof typeof assets] === tokenAddress) || null

				return result
			}

			for (let i = 0; i < order.inputs.length; i++) {
				const input = order.inputs[i]
				const output = order.output.assets[i]

				const inputType = getTokenType(input.token, order.source)
				const outputType = getTokenType(output.token, order.destination)

				if (!inputType) {
					this.logger.debug({ index: i, token: input.token }, "Unsupported input token")
					return false
				}

				if (!outputType) {
					this.logger.debug({ index: i, token: output.token }, "Unsupported output token")
					return false
				}

				if (inputType !== outputType) {
					this.logger.debug({ index: i, inputType, outputType }, "Token mismatch")
					return false
				}

				const [inputDecimals, outputDecimals] = await Promise.all([
					this.contractService.getTokenDecimals(input.token, order.source),
					this.contractService.getTokenDecimals(output.token, order.destination),
				])

				if (!compareDecimalValues(input.amount, inputDecimals, output.amount, outputDecimals)) {
					this.logger.debug(
						{
							index: i,
							inputAmount: input.amount.toString(),
							inputDecimals,
							outputAmount: output.amount.toString(),
							outputDecimals,
						},
						"Amount mismatch",
					)
					return false
				}
			}

			return true
		} catch (error) {
			this.logger.error({ err: error }, "Order validation failed")
			return false
		}
	}
}
