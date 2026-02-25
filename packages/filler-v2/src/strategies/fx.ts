import { FillerStrategy } from "@/strategies/base"
import {
	OrderV2,
	ExecutionResult,
	HexString,
	bytes32ToBytes20,
	FillOptionsV2,
	ADDRESS_ZERO,
	IntentsCoprocessor,
	transformOrderForContract,
	adjustDecimals,
	encodeERC7821ExecuteBatch,
	Swap,
	type ERC7821Call,
} from "@hyperbridge/sdk"
import { INTENT_GATEWAY_V2_ABI } from "@/config/abis/IntentGatewayV2"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { privateKeyToAccount } from "viem/accounts"
import { ChainClientManager, ContractInteractionService, BidStorageService } from "@/services"
import { FillerConfigService } from "@/services/FillerConfigService"
import { encodeFunctionData, formatUnits, maxUint256 } from "viem"
import { getLogger } from "@/services/Logger"
import { FillerBpsPolicy } from "@/config/interpolated-curve"
import { Decimal } from "decimal.js"

type StableTokenType = "USDC" | "USDT"
enum Direction {
	STABLE_TO_CNGN = "stable_to_cngn",
	CNGN_TO_STABLE = "cngn_to_stable",
}

/**
 * Strategy for same-chain swaps between stablecoins (USDC/USDT) and cNGN.
 *
 * The filler holds USDC/USDT. When a user places a same-chain order wanting cNGN
 * in exchange for USDC/USDT (or vice versa), this strategy:
 * 1. Swaps the filler's stablecoins to the required output token via DEX
 * 2. Calls fillOrder to deliver output tokens to the user
 * 3. Receives the user's escrowed input tokens from the contract
 *
 * cNGN token addresses and decimals are resolved from ChainConfigService
 * (configured per chain in the SDK's chain config).
 */
export class SameChainSwapFiller implements FillerStrategy {
	name = "fx"
	private privateKey: HexString
	private clientManager: ChainClientManager
	private contractService: ContractInteractionService
	private configService: FillerConfigService
	private bidStorage?: BidStorageService
	private bpsPolicy: FillerBpsPolicy
	private swap: Swap
	private logger = getLogger("fx")

	constructor(
		privateKey: HexString,
		configService: FillerConfigService,
		clientManager: ChainClientManager,
		contractService: ContractInteractionService,
		bpsPolicy: FillerBpsPolicy,
		bidStorage?: BidStorageService,
	) {
		this.privateKey = privateKey
		this.configService = configService
		this.clientManager = clientManager
		this.contractService = contractService
		this.bidStorage = bidStorage
		this.bpsPolicy = bpsPolicy
		this.swap = new Swap()
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
			const client = this.clientManager.getPublicClient(chain)
			const { decimals: feeTokenDecimals } = await this.contractService.getFeeTokenWithDecimals(chain)

			const basisPoints = 10000n
			let totalProfitInStable = 0n
			let stableDecimals = 0

			// Compute USD value from the stable side (for BPS lookup).
			// STABLE→cNGN: stable is on the input side. cNGN→STABLE: stable is on the output side.
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

			const fillerBps = this.bpsPolicy.getBps(stableUsdValue)

			for (let i = 0; i < order.inputs.length; i++) {
				const input = order.inputs[i]
				const output = order.output.assets[i]
				const pair = this.classifyPair(input.token, output.token, chain)!

				const stableAddress = bytes32ToBytes20(pair.stableToken) as HexString
				const cNgnAddress = bytes32ToBytes20(pair.cNgnToken) as HexString
				stableDecimals =
					pair.stableType === "USDC"
						? this.configService.getUsdcDecimals(chain)
						: this.configService.getUsdtDecimals(chain)

				if (pair.direction === Direction.STABLE_TO_CNGN) {
					// User sends stables, wants cNGN.
					// Filler buys output.amount of cNGN on DEX, delivers to user,
					// then receives input.amount stables from escrow.
					const { amountIn } = await this.swap.findBestProtocolWithAmountOut(
						client as any,
						stableAddress,
						cNgnAddress,
						output.amount,
						chain,
					)
					if (amountIn === 0n) {
						this.logger.warn({ orderId: order.id }, "No DEX liquidity for stable → cNGN")
						return 0
					}
					const swapProfit = input.amount - amountIn
					const minProfit = (input.amount * fillerBps) / basisPoints
					if (swapProfit < minProfit) {
						this.logger.info(
							{
								orderId: order.id,
								swapProfit: swapProfit.toString(),
								minProfit: minProfit.toString(),
								fillerBps: fillerBps.toString(),
							},
							"Swap profit below BPS minimum threshold (stable → cNGN)",
						)
						return 0
					}
					totalProfitInStable += swapProfit
				} else {
					// User sends cNGN, wants stables.
					// Filler delivers output.amount stables from its own balance,
					// receives input.amount cNGN from escrow, then sells cNGN on DEX.
					const { amountOut } = await this.swap.findBestProtocolWithAmountIn(
						client as any,
						cNgnAddress,
						stableAddress,
						input.amount,
						chain,
					)
					if (amountOut === 0n) {
						this.logger.warn({ orderId: order.id }, "No DEX liquidity for cNGN → stable")
						return 0
					}
					const swapProfit = amountOut - output.amount
					const minProfit = (output.amount * fillerBps) / basisPoints
					if (swapProfit < minProfit) {
						this.logger.info(
							{
								orderId: order.id,
								swapProfit: swapProfit.toString(),
								minProfit: minProfit.toString(),
								fillerBps: fillerBps.toString(),
							},
							"Swap profit below BPS minimum threshold (cNGN → stable)",
						)
						return 0
					}
					totalProfitInStable += swapProfit
				}
			}

			// Cache filler outputs — deliver exactly what the order specifies
			this.contractService.cacheService.setFillerOutputs(order.id!, [...order.output.assets])

			// Factor in gas costs vs order fees (same chain → single fee token)
			const { totalCostInSourceFeeToken } = await this.contractService.estimateGasFillPost(order)

			const feeProfit = order.fees > totalCostInSourceFeeToken ? order.fees - totalCostInSourceFeeToken : 0n

			// Normalize swap profit from stableDecimals to feeTokenDecimals before summing
			const swapProfitNormalized = adjustDecimals(totalProfitInStable, stableDecimals, feeTokenDecimals)
			const totalProfit = swapProfitNormalized + feeProfit

			this.logger.info(
				{
					orderId: order.id,
					orderValueUsd: stableUsdValue.toString(),
					fillerBps: fillerBps.toString(),
					swapProfit: formatUnits(totalProfitInStable, stableDecimals),
					swapProfitNormalized: formatUnits(swapProfitNormalized, feeTokenDecimals),
					feeProfit: formatUnits(feeProfit, feeTokenDecimals),
					totalProfit: formatUnits(totalProfit, feeTokenDecimals),
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
					error: "SameChainSwapFiller requires the UserOp/Hyperbridge path (intentsCoprocessor must be provided)",
				}
			}
			return await this.submitBidWithSwap(order, startTime, intentsCoprocessor)
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
	 * Builds the full ERC-7821 batch calldata (swap + fillOrder) and submits
	 * it as a UserOp bid to Hyperbridge. The batch executes atomically on-chain
	 * via the filler's EIP-7702 delegated SolverAccount.
	 */
	private async submitBidWithSwap(
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

		const chain = order.source
		const client = this.clientManager.getPublicClient(chain)
		const solverAccountAddress = privateKeyToAccount(this.privateKey).address as HexString
		const intentGateway = this.configService.getIntentGatewayV2Address(chain)

		const cachedFillerOutputs = this.contractService.cacheService.getFillerOutputs(order.id!)
		if (!cachedFillerOutputs) {
			throw new Error(`No cached filler outputs for order ${order.id}. Call calculateProfitability first.`)
		}

		const { dispatchFee, nativeDispatchFee } = await this.contractService.estimateGasFillPost(order)

		const fillOptions: FillOptionsV2 = {
			relayerFee: dispatchFee,
			nativeDispatchFee,
			outputs: cachedFillerOutputs,
		}

		// Build the ERC-7821 batch calldata
		const batchCallData = await this.buildBatchCallData(
			order,
			fillOptions,
			intentGateway,
			solverAccountAddress,
			client,
		)

		this.logger.info({ orderId: order.id }, "Built ERC-7821 batch calldata for swap+fill")

		// Submit bid with the custom batch callData
		const { commitment, userOp } = await this.contractService.prepareBidUserOp(
			order,
			entryPointAddress,
			solverAccountAddress,
			batchCallData,
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

	/**
	 * Builds the ERC-7821 batch calldata containing swap + fillOrder calls
	 * in the correct order based on direction.
	 *
	 * cNGN → STABLE: [fillOrder, swap cNGN→stable]
	 * STABLE → cNGN: [swap stable→cNGN, approve cNGN→gateway, fillOrder]
	 */
	private async buildBatchCallData(
		order: OrderV2,
		fillOptions: FillOptionsV2,
		intentGateway: HexString,
		recipient: HexString,
		client: any,
	): Promise<HexString> {
		const chain = order.source
		const pair = this.classifyPair(order.inputs[0].token, order.output.assets[0].token, chain)!
		const stableAddress = bytes32ToBytes20(pair.stableToken) as HexString
		const cNgnAddress = bytes32ToBytes20(pair.cNgnToken) as HexString

		// Encode fillOrder calldata
		const fillOrderCalldata = encodeFunctionData({
			abi: INTENT_GATEWAY_V2_ABI,
			functionName: "fillOrder",
			args: [transformOrderForContract(order) as any, fillOptions as any],
		}) as HexString

		const nativeOutputValue = order.output.assets
			.filter((asset) => bytes32ToBytes20(asset.token) === ADDRESS_ZERO)
			.reduce((sum, asset) => sum + asset.amount, 0n)
		const totalNativeValue = nativeOutputValue + fillOptions.nativeDispatchFee

		const fillOrderCall: ERC7821Call = {
			target: intentGateway,
			value: totalNativeValue,
			data: fillOrderCalldata,
		}

		const calls: ERC7821Call[] = []

		if (pair.direction === Direction.CNGN_TO_STABLE) {
			// cNGN → STABLE: fillOrder first (deliver stables, receive cNGN), then swap cNGN → stables
			calls.push(fillOrderCall)

			// Generate swap calldata: sell order.input.amount of cNGN for stables
			const { transactions: swapTxs } = await this.swap.findBestProtocolWithAmountIn(
				client,
				cNgnAddress,
				stableAddress,
				order.inputs[0].amount,
				chain,
				{ generateCalldata: true, recipient },
			)
			if (!swapTxs || swapTxs.length === 0) {
				throw new Error("Failed to generate swap calldata for cNGN → stable")
			}

			// Approve cNGN to DEX router before swap
			const approveCall: ERC7821Call = {
				target: cNgnAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: ERC20_ABI,
					functionName: "approve",
					args: [swapTxs[0].to as HexString, maxUint256],
				}) as HexString,
			}
			calls.push(approveCall)

			for (const swapTx of swapTxs) {
				calls.push({
					target: swapTx.to as HexString,
					value: swapTx.value ?? 0n,
					data: swapTx.data as HexString,
				})
			}
		} else {
			// STABLE → cNGN: swap stables → cNGN first, then approve cNGN, then fillOrder

			// Generate swap calldata: buy order.output.amount of cNGN with stables
			const { transactions: swapTxs } = await this.swap.findBestProtocolWithAmountOut(
				client,
				stableAddress,
				cNgnAddress,
				order.output.assets[0].amount,
				chain,
				{ generateCalldata: true, recipient },
			)
			if (!swapTxs || swapTxs.length === 0) {
				throw new Error("Failed to generate swap calldata for stable → cNGN")
			}

			for (const swapTx of swapTxs) {
				calls.push({
					target: swapTx.to as HexString,
					value: swapTx.value ?? 0n,
					data: swapTx.data as HexString,
				})
			}

			// Approve cNGN to IntentGateway for fillOrder's safeTransferFrom
			const approveCall: ERC7821Call = {
				target: cNgnAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: ERC20_ABI,
					functionName: "approve",
					args: [intentGateway, maxUint256],
				}) as HexString,
			}
			calls.push(approveCall)

			calls.push(fillOrderCall)
		}

		this.logger.debug(
			{
				orderId: order.id,
				direction: pair.direction,
				callCount: calls.length,
			},
			"ERC-7821 batch calls constructed",
		)

		return encodeERC7821ExecuteBatch(calls)
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
		stableType: StableTokenType
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

	private getStableType(normalizedAddress: string, chain: string): StableTokenType | null {
		if (normalizedAddress === this.configService.getUsdcAsset(chain).toLowerCase()) return "USDC"
		if (normalizedAddress === this.configService.getUsdtAsset(chain).toLowerCase()) return "USDT"
		return null
	}
}
