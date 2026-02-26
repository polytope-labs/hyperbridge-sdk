import { FillerStrategy } from "@/strategies/base"
import {
	OrderV2,
	ExecutionResult,
	HexString,
	bytes32ToBytes20,
	FillOptionsV2,
	TokenInfoV2,
	IntentsCoprocessor,
	adjustDecimals,
} from "@hyperbridge/sdk"
import { privateKeyToAccount } from "viem/accounts"
import { ChainClientManager, ContractInteractionService, BidStorageService } from "@/services"
import { FillerConfigService } from "@/services/FillerConfigService"
import { formatUnits } from "viem"
import { getLogger } from "@/services/Logger"
import { FillerPricePolicy } from "@/config/interpolated-curve"
import { Decimal } from "decimal.js"
import { SupportedTokenType } from "@/strategies/base"

enum Direction {
	STABLE_TO_CNGN = "stable_to_cngn",
	CNGN_TO_STABLE = "cngn_to_stable",
}

/**
 * Strategy for same-chain swaps between stablecoins (USDC/USDT) and cNGN.
 *
 * The filler holds both USDC/USDT and cNGN. When a user places a same-chain
 * order wanting cNGN in exchange for USDC/USDT (or vice versa), this strategy:
 * 1. Evaluates profitability using the filler's known cNGN price
 * 2. Calls fillOrder to deliver output tokens to the user
 * 3. Receives the user's escrowed input tokens from the contract
 *
 * The filler manages their own internal rebalancing/swaps outside of order execution.
 */
export class FXFiller implements FillerStrategy {
	name = "FXFiller"
	private privateKey: HexString
	private clientManager: ChainClientManager
	private contractService: ContractInteractionService
	private configService: FillerConfigService
	private bidStorage?: BidStorageService
	/** cNGN price policy in USD as a function of order USD value */
	private pricePolicy: FillerPricePolicy
	private cNgnDecimals: number
	private logger = getLogger("fx-filler")

	constructor(
		privateKey: HexString,
		configService: FillerConfigService,
		clientManager: ChainClientManager,
		contractService: ContractInteractionService,
		pricePolicy: FillerPricePolicy,
		cNgnDecimals: number,
		bidStorage?: BidStorageService,
	) {
		this.privateKey = privateKey
		this.configService = configService
		this.clientManager = clientManager
		this.contractService = contractService
		this.bidStorage = bidStorage
		this.pricePolicy = pricePolicy
		this.cNgnDecimals = cNgnDecimals
	}

	async canFill(order: OrderV2): Promise<boolean> {
		try {
			if (order.source !== order.destination) {
				return false
			}

			if (order.inputs.length !== order.output.assets.length) {
				this.logger.debug(
					{ inputs: order.inputs.length, outputs: order.output.assets.length },
					"Order input/output length mismatch or empty",
				)
				return false
			}

			const chain = order.source

			for (let i = 0; i < order.inputs.length; i++) {
				const pair = this.classifyPair(order.inputs[i].token, order.output.assets[i].token, chain)
				if (!pair) {
					this.logger.debug({ index: i }, "Unsupported token pair for same-chain swap")
					return false
				}
			}

			return true
		} catch (error) {
			this.logger.error({ err: error }, "Error in canFill")
			return false
		}
	}

	async calculateProfitability(order: OrderV2): Promise<number> {
		try {
			const chain = order.source
			const { decimals: feeTokenDecimals } = await this.contractService.getFeeTokenWithDecimals(chain)

			// Compute USD value from the stable side (for price lookup).
			let stableUsdValue = new Decimal(0)
			for (let i = 0; i < order.inputs.length; i++) {
				const pair = this.classifyPair(order.inputs[i].token, order.output.assets[i].token, chain)!
				const sd =
					pair.stableType === "USDC"
						? this.configService.getUsdcDecimals(chain)
						: this.configService.getUsdtDecimals(chain)

				if (pair.direction === Direction.STABLE_TO_CNGN) {
					stableUsdValue = stableUsdValue.plus(new Decimal(formatUnits(order.inputs[i].amount, sd)))
				} else {
					stableUsdValue = stableUsdValue.plus(new Decimal(formatUnits(order.output.assets[i].amount, sd)))
				}
			}

			const cNgnPriceUsd = this.pricePolicy.getPrice(stableUsdValue)
			const fillerOutputs: TokenInfoV2[] = []

			for (let i = 0; i < order.inputs.length; i++) {
				const input = order.inputs[i]
				const output = order.output.assets[i]
				const pair = this.classifyPair(input.token, output.token, chain)!

				const stableDecimals =
					pair.stableType === "USDC"
						? this.configService.getUsdcDecimals(chain)
						: this.configService.getUsdtDecimals(chain)

				let fillerMaxOutput: bigint

				if (pair.direction === Direction.STABLE_TO_CNGN) {
					const inputUsd = new Decimal(formatUnits(input.amount, stableDecimals))
					const cNgnFromInput = inputUsd.div(cNgnPriceUsd)
					fillerMaxOutput = BigInt(
						cNgnFromInput.mul(new Decimal(10).pow(this.cNgnDecimals)).floor().toFixed(0),
					)
				} else {
					const cNgnUsd = cNgnPriceUsd.mul(new Decimal(formatUnits(input.amount, this.cNgnDecimals)))
					fillerMaxOutput = BigInt(cNgnUsd.mul(new Decimal(10).pow(stableDecimals)).floor().toFixed(0))
				}

				if (output.amount > fillerMaxOutput) {
					this.logger.info(
						{
							orderId: order.id,
							userExpects: output.amount.toString(),
							fillerWillProvide: fillerMaxOutput.toString(),
							pricePolicyUsd: cNgnPriceUsd.toString(),
						},
						"User expects more than filler can provide at policy price",
					)
					return 0
				}

				fillerOutputs.push({ token: output.token, amount: fillerMaxOutput })
			}

			this.contractService.cacheService.setFillerOutputs(order.id!, fillerOutputs)

			const { totalCostInSourceFeeToken } = await this.contractService.estimateGasFillPost(order)
			const feeProfit = order.fees > totalCostInSourceFeeToken ? order.fees - totalCostInSourceFeeToken : 0n
			const totalProfit = adjustDecimals(feeProfit, feeTokenDecimals, feeTokenDecimals)

			this.logger.info(
				{
					orderId: order.id,
					orderValueUsd: stableUsdValue.toString(),
					cNgnPriceUsd: cNgnPriceUsd.toString(),
					feeProfit: formatUnits(totalProfit, feeTokenDecimals),
					profitable: totalProfit > 0n,
				},
				"Same-chain swap profitability evaluation",
			)

			return parseFloat(formatUnits(totalProfit, feeTokenDecimals))
		} catch (error) {
			this.logger.error({ err: error }, "Error calculating profitability")
			return 0
		}
	}

	async executeOrder(order: OrderV2, intentsCoprocessor?: IntentsCoprocessor): Promise<ExecutionResult> {
		const startTime = Date.now()

		try {
			if (!intentsCoprocessor) {
				return {
					success: false,
					error: "FXFiller requires the UserOp/Hyperbridge path (intentsCoprocessor must be provided)",
				}
			}

			// Ensure tokens are approved before submitting bid
			await this.contractService.approveTokensIfNeeded(order)

			return await this.submitBid(order, startTime, intentsCoprocessor)
		} catch (error) {
			this.logger.error({ err: error }, "Error executing same-chain swap order")
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}

	// =========================================================================
	// Private — Execution
	// =========================================================================

	/**
	 * Prepares and submits a bid UserOp to Hyperbridge.
	 * Since the filler holds both tokens, no custom batch calldata is needed —
	 * the standard fillOrder flow handles token delivery and escrow release.
	 */
	private async submitBid(
		order: OrderV2,
		startTime: number,
		intentsCoprocessor: IntentsCoprocessor,
	): Promise<ExecutionResult> {
		const entryPointAddress = this.configService.getEntryPointAddress(order.destination)
		if (!entryPointAddress) {
			return {
				success: false,
				error: `EntryPoint not configured for chain ${order.destination}`,
			}
		}

		const solverAccountAddress = privateKeyToAccount(this.privateKey).address as HexString

		const cachedFillerOutputs = this.contractService.cacheService.getFillerOutputs(order.id!)
		if (!cachedFillerOutputs) {
			throw new Error(`No cached filler outputs for order ${order.id}. Call calculateProfitability first.`)
		}

		const { commitment, userOp } = await this.contractService.prepareBidUserOp(
			order,
			entryPointAddress,
			solverAccountAddress,
		)

		const bidResult = await intentsCoprocessor.submitBid(commitment, userOp)

		const endTime = Date.now()
		if (bidResult.success) {
			this.logger.info({ commitment }, "Bid submitted successfully")
			this.bidStorage?.storeBid({
				commitment,
				extrinsicHash: bidResult.extrinsicHash!,
				blockHash: bidResult.blockHash!,
				success: true,
			})
			return {
				success: true,
				txHash: bidResult.extrinsicHash,
				strategyUsed: this.name,
				processingTimeMs: endTime - startTime,
			}
		}

		this.logger.error({ commitment, error: bidResult.error }, "Bid submission failed")
		this.bidStorage?.storeBid({ commitment, success: false, error: bidResult.error })
		return { success: false, error: bidResult.error }
	}

	// =========================================================================
	// Private — Helpers
	// =========================================================================

	private classifyPair(
		inputToken: string,
		outputToken: string,
		chain: string,
	): {
		direction: Direction
		stableType: SupportedTokenType
		stableToken: string
		cNgnToken: string
	} | null {
		const cNgnAddress = this.configService.getCNgnAsset(chain)
		if (!cNgnAddress) {
			throw new Error(`cNGN address not configured for chain ${chain}`)
		}

		const normalizedInput = bytes32ToBytes20(inputToken).toLowerCase()
		const normalizedOutput = bytes32ToBytes20(outputToken).toLowerCase()
		const normalizedCNgn = cNgnAddress.toLowerCase()

		const inputStable = this.getStableType(normalizedInput, chain)
		const outputStable = this.getStableType(normalizedOutput, chain)

		if (inputStable && normalizedOutput === normalizedCNgn) {
			return {
				direction: Direction.STABLE_TO_CNGN,
				stableType: inputStable,
				stableToken: inputToken,
				cNgnToken: outputToken,
			}
		}

		if (normalizedInput === normalizedCNgn && outputStable) {
			return {
				direction: Direction.CNGN_TO_STABLE,
				stableType: outputStable,
				stableToken: outputToken,
				cNgnToken: inputToken,
			}
		}

		return null
	}

	private getStableType(normalizedAddress: string, chain: string): SupportedTokenType | null {
		if (normalizedAddress === this.configService.getUsdcAsset(chain).toLowerCase()) return "USDC"
		if (normalizedAddress === this.configService.getUsdtAsset(chain).toLowerCase()) return "USDT"
		return null
	}
}
