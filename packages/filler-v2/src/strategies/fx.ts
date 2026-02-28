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
	ADDRESS_ZERO,
} from "@hyperbridge/sdk"
import { privateKeyToAccount } from "viem/accounts"
import { ChainClientManager, ContractInteractionService, BidStorageService } from "@/services"
import { FillerConfigService } from "@/services/FillerConfigService"
import { formatUnits } from "viem"
import { getLogger } from "@/services/Logger"
import { FillerPricePolicy } from "@/config/interpolated-curve"
import { Decimal } from "decimal.js"
import { SupportedTokenType } from "@/strategies/base"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { INTENT_GATEWAY_V2_ABI } from "@/config/abis/IntentGatewayV2"
import { encodeFunctionData, maxUint256 } from "viem"
import { encodeERC7821ExecuteBatch, type ERC7821Call } from "@hyperbridge/sdk"

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
 *
 * This implementation also enforces a per-order USD cap for risk management:
 * - A maximum order USD value is configured on the constructor.
 * - The price policy is always evaluated on the capped USD amount.
 * - The capped USD budget is then allocated across legs in order to determine
 *   how much the filler is willing to output.
 * - Actual outputs are further limited by the filler's real token balances.
 *
 * Because the IntentGateway releases inputs proportionally to the fraction of
 * outputs provided, this allows safe partial fills (and even overfills relative
 * to the user's requested outputs) without additional on-chain logic here.
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
	private maxOrderUsd: Decimal
	private logger = getLogger("fx-filler")

	/**
	 * @param privateKey         Filler's private key used to sign UserOps.
	 * @param configService      Network/config provider for addresses and decimals.
	 * @param clientManager      Used to get viem PublicClients for chains.
	 * @param contractService    Shared contract interaction service.
	 * @param pricePolicy        cNGN price curve as a function of order USD value.
	 * @param maxOrderUsdStr     Maximum USD value this filler is willing to fill per order.
	 *                            Example: "5000" means, even if the order is for $10,000,
	 *                            the filler will only size its outputs as if the order were $5,000.
	 * @param cNgnDecimals       Decimals for the cNGN token on the destination chain.
	 * @param bidStorage         Optional storage for submitted bids.
	 */
	constructor(
		privateKey: HexString,
		configService: FillerConfigService,
		clientManager: ChainClientManager,
		contractService: ContractInteractionService,
		pricePolicy: FillerPricePolicy,
		maxOrderUsdStr: string,
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
		this.maxOrderUsd = new Decimal(maxOrderUsdStr)
		if (this.maxOrderUsd.lte(0)) {
			throw new Error("FXFiller maxOrderUsd must be greater than 0")
		}
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

	/**
	 * Evaluates whether an order is profitable to fill under the configured
	 * per-order USD cap and the filler's current token balances.
	 *
	 * High-level flow:
	 * - Compute the total USD value of the order on the stable side.
	 * - Cap this at `maxOrderUsd` to get a capped USD budget.
	 * - Ask the price policy for a cNGN price at that capped USD.
	 * - Walk each (input, output) leg in order, allocating from the capped USD
	 *   budget and computing how much the filler is willing to output.
	 * - Further cap each leg by the filler's current token balance.
	 * - Cache the resulting outputs for later use in `executeOrder`.
	 *
	 * Note: we may intentionally overfill relative to the user's requested
	 * outputs if the price policy makes that attractive. This is how we stay competitive.
	 */
	async calculateProfitability(order: OrderV2): Promise<number> {
		try {
			const chain = order.source
			const { decimals: feeTokenDecimals } = await this.contractService.getFeeTokenWithDecimals(chain)

			const destClient = this.clientManager.getPublicClient(chain)
			const walletAddress = privateKeyToAccount(this.privateKey).address as HexString
			const balanceCache = new Map<string, bigint>()

			// Compute USD value from the stable side (for price lookup).
			let totalOrderUsd = new Decimal(0)
			for (let i = 0; i < order.inputs.length; i++) {
				const pair = this.classifyPair(order.inputs[i].token, order.output.assets[i].token, chain)!
				const sd =
					pair.stableType === "USDC"
						? this.configService.getUsdcDecimals(chain)
						: this.configService.getUsdtDecimals(chain)

				if (pair.inputIsStable) {
					totalOrderUsd = totalOrderUsd.plus(new Decimal(formatUnits(order.inputs[i].amount, sd)))
				} else {
					totalOrderUsd = totalOrderUsd.plus(new Decimal(formatUnits(order.output.assets[i].amount, sd)))
				}
			}

			const cappedOrderUsd = Decimal.min(totalOrderUsd, this.maxOrderUsd)
			if (cappedOrderUsd.lte(0)) {
				this.logger.info(
					{
						orderId: order.id,
						orderValueUsdFull: totalOrderUsd.toString(),
						orderValueUsdCapped: cappedOrderUsd.toString(),
						maxOrderUsd: this.maxOrderUsd.toString(),
					},
					"Skipping order: capped USD value is non-positive",
				)
				return 0
			}

			const cNgnPriceUsd = this.pricePolicy.getPrice(cappedOrderUsd)
			const fillerOutputs: TokenInfoV2[] = []
			let remainingUsd = cappedOrderUsd

			for (let i = 0; i < order.inputs.length; i++) {
				const input = order.inputs[i]
				const output = order.output.assets[i]
				const pair = this.classifyPair(input.token, output.token, chain)!

				const stableDecimals =
					pair.stableType === "USDC"
						? this.configService.getUsdcDecimals(chain)
						: this.configService.getUsdtDecimals(chain)

				const legResult = this.computeLegPolicyOutput(
					input.amount,
					output.amount,
					pair.inputIsStable,
					stableDecimals,
					remainingUsd,
					cNgnPriceUsd,
				)

				if (!legResult) {
					continue
				}

				const { usdUsed, policyMaxOutput } = legResult
				remainingUsd = remainingUsd.minus(usdUsed)

				// Cap by actual available balance for this token on the filler side.
				const tokenAddress = bytes32ToBytes20(output.token).toLowerCase()
				const balance = await this.getAndCacheBalance(tokenAddress, walletAddress, destClient, balanceCache)

				const finalOutputAmount = balance > policyMaxOutput ? policyMaxOutput : balance

				if (finalOutputAmount === 0n) {
					this.logger.info(
						{
							orderId: order.id,
							token: output.token,
							fillerBalance: balance.toString(),
						},
						"Skipping leg: no available balance for required output token",
					)
					continue
				}

				// Decrement remaining balance for this token so repeated outputs share the same pool.
				const remaining = balance - finalOutputAmount
				balanceCache.set(tokenAddress, remaining > 0n ? remaining : 0n)

				fillerOutputs.push({ token: output.token, amount: finalOutputAmount })

				if (remainingUsd.lte(0)) {
					break
				}
			}

			if (fillerOutputs.length === 0) {
				this.logger.info(
					{
						orderId: order.id,
						orderValueUsdFull: totalOrderUsd.toString(),
						orderValueUsdCapped: cappedOrderUsd.toString(),
						maxOrderUsd: this.maxOrderUsd.toString(),
					},
					"Skipping order: no outputs after applying USD cap and balance constraints",
				)
				return 0
			}

			this.contractService.cacheService.setFillerOutputs(order.id!, fillerOutputs)

			const { totalCostInSourceFeeToken } = await this.contractService.estimateGasFillPost(order)
			const feeProfit = order.fees > totalCostInSourceFeeToken ? order.fees - totalCostInSourceFeeToken : 0n
			const totalProfit = adjustDecimals(feeProfit, feeTokenDecimals, feeTokenDecimals)

			this.logger.info(
				{
					orderId: order.id,
					orderValueUsdFull: totalOrderUsd.toString(),
					orderValueUsdCapped: cappedOrderUsd.toString(),
					maxOrderUsd: this.maxOrderUsd.toString(),
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

	/**
	 * Executes an order by submitting a bid via the IntentsCoprocessor.
	 *
	 * Assumes that `calculateProfitability` has already been called for the
	 * given order so that filler outputs are cached in `contractService`.
	 * This method only orchestrates the bid construction and submission; the
	 * actual token movements are handled on-chain by the IntentGateway.
	 */
	async executeOrder(order: OrderV2, intentsCoprocessor?: IntentsCoprocessor): Promise<ExecutionResult> {
		const startTime = Date.now()

		try {
			if (!intentsCoprocessor) {
				return {
					success: false,
					error: "FXFiller requires the UserOp/Hyperbridge path (intentsCoprocessor must be provided)",
				}
			}

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
	 * Prepares and submits a bid UserOp to Hyperbridge for the given order.
	 *
	 * Uses the filler outputs previously cached by `calculateProfitability`
	 * to build optional ERC20 approvals plus a `fillOrder` call (via
	 * `buildApprovalAndFillCalldata`), wraps them in a UserOp, and submits
	 * through the provided `IntentsCoprocessor`. Bid metadata is persisted
	 * to `BidStorageService` when available.
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

		// Build optional batched calldata that includes any required ERC20 approvals
		// followed by the fillOrder call, executed via ERC-7821.
		const approvalAndFillCalldata = await this.buildApprovalAndFillCalldata(order, cachedFillerOutputs)

		const { commitment, userOp } = await this.contractService.prepareBidUserOp(
			order,
			entryPointAddress,
			solverAccountAddress,
			approvalAndFillCalldata,
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

	/**
	 * Given a single (input, output) leg and the remaining capped USD budget,
	 * computes how much USD to allocate to this leg and the corresponding
	 * maximum output amount according to the price policy.
	 *
	 * Returns `null` when this leg cannot consume any of the remaining USD
	 * budget (e.g. the cap has already been exhausted).
	 */
	private computeLegPolicyOutput(
		inputAmount: bigint,
		outputAmount: bigint,
		inputIsStable: boolean,
		stableDecimals: number,
		remainingUsd: Decimal,
		cNgnPriceUsd: Decimal,
	): { usdUsed: Decimal; policyMaxOutput: bigint } | null {
		let legMaxUsd: Decimal
		if (inputIsStable) {
			legMaxUsd = new Decimal(formatUnits(inputAmount, stableDecimals))
		} else {
			legMaxUsd = new Decimal(formatUnits(outputAmount, stableDecimals))
		}

		const usdForLeg = Decimal.min(legMaxUsd, remainingUsd)
		if (usdForLeg.lte(0)) {
			return null
		}

		let policyMaxOutput: bigint
		if (inputIsStable) {
			const cNgnFromAlloc = usdForLeg.div(cNgnPriceUsd)
			policyMaxOutput = BigInt(cNgnFromAlloc.mul(new Decimal(10).pow(this.cNgnDecimals)).floor().toFixed(0))
		} else {
			policyMaxOutput = BigInt(usdForLeg.mul(new Decimal(10).pow(stableDecimals)).floor().toFixed(0))
		}

		return { usdUsed: usdForLeg, policyMaxOutput }
	}

	/**
	 * Reads and caches the filler's balance for a token on the destination chain.
	 *
	 * Normalizes the token address, checks an in-memory cache, and only hits
	 * the chain (native `getBalance` or ERC20 `balanceOf`) on a cache miss.
	 * This allows multiple legs within a single profitability evaluation to
	 * share the same balance pool.
	 */
	private async getAndCacheBalance(
		tokenAddressLower: string,
		walletAddress: HexString,
		destClient: any,
		balanceCache: Map<string, bigint>,
	): Promise<bigint> {
		const key = tokenAddressLower.toLowerCase()
		const cached = balanceCache.get(key)
		if (cached !== undefined) {
			return cached
		}

		let balance: bigint
		if (key === ADDRESS_ZERO.toLowerCase()) {
			balance = await destClient.getBalance({ address: walletAddress })
		} else {
			balance = await destClient.readContract({
				abi: ERC20_ABI,
				address: key as HexString,
				functionName: "balanceOf",
				args: [walletAddress],
			})
		}

		balanceCache.set(key, balance)
		return balance
	}

	/**
	 * Builds ERC-7821 calldata that:
	 * 1) Performs any required ERC20 approvals to IntentGatewayV2
	 * 2) Calls fillOrder with the previously computed filler outputs.
	 *
	 * If no approvals are required, this returns undefined so that the SDK
	 * can fall back to its default single-call fillOrder batching.
	 */
	private async buildApprovalAndFillCalldata(
		order: OrderV2,
		fillerOutputs: TokenInfoV2[],
	): Promise<HexString | undefined> {
		const chain = order.destination
		const destClient = this.clientManager.getPublicClient(chain)
		const wallet = privateKeyToAccount(this.privateKey)
		const walletAddress = wallet.address as HexString

		const cachedEstimate = this.contractService.cacheService.getGasEstimate(order.id!)
		if (!cachedEstimate) {
			throw new Error(`No cached gas estimate found for order ${order.id}. Call estimateGasFillPost first.`)
		}

		const fillOptions: FillOptionsV2 = {
			relayerFee: cachedEstimate.dispatchFee,
			nativeDispatchFee: cachedEstimate.nativeDispatchFee,
			outputs: fillerOutputs,
		}

		const intentGatewayV2Address = this.configService.getIntentGatewayV2Address(chain)

		// Aggregate required amounts per ERC20 token
		const perTokenRequired = new Map<string, bigint>()
		for (const output of fillerOutputs) {
			const addr = bytes32ToBytes20(output.token)
			if (addr === ADDRESS_ZERO) continue
			const key = addr.toLowerCase()
			perTokenRequired.set(key, (perTokenRequired.get(key) ?? 0n) + output.amount)
		}

		const feeToken = await this.contractService.getFeeTokenWithDecimals(chain)
		const key = feeToken.address.toLowerCase()
		perTokenRequired.set(key, (perTokenRequired.get(key) ?? 0n) + cachedEstimate.totalCostInSourceFeeToken)

		// Check allowances and collect tokens needing approval
		const calls: ERC7821Call[] = []
		for (const [tokenAddress, required] of perTokenRequired.entries()) {
			const allowance = await destClient.readContract({
				abi: ERC20_ABI,
				address: tokenAddress as HexString,
				functionName: "allowance",
				args: [walletAddress, intentGatewayV2Address],
			})

			if (allowance < required) {
				calls.push({
					target: tokenAddress as HexString,
					value: 0n,
					data: encodeFunctionData({
						abi: ERC20_ABI,
						functionName: "approve",
						args: [intentGatewayV2Address, maxUint256],
					}) as HexString,
				})
			}
		}

		if (calls.length === 0) return undefined

		// Append fillOrder call
		const nativeOutputValue = fillerOutputs
			.filter((asset) => bytes32ToBytes20(asset.token) === ADDRESS_ZERO)
			.reduce((sum, asset) => sum + asset.amount, 0n)

		calls.push({
			target: intentGatewayV2Address,
			value: nativeOutputValue + fillOptions.nativeDispatchFee,
			data: encodeFunctionData({
				abi: INTENT_GATEWAY_V2_ABI,
				functionName: "fillOrder",
				args: [order as any, fillOptions as any],
			}) as HexString,
		})

		return encodeERC7821ExecuteBatch(calls)
	}

	private classifyPair(
		inputToken: string,
		outputToken: string,
		chain: string,
	): {
		inputIsStable: boolean
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
			return { inputIsStable: true, stableType: inputStable, stableToken: inputToken, cNgnToken: outputToken }
		}

		if (normalizedInput === normalizedCNgn && outputStable) {
			return { inputIsStable: false, stableType: outputStable, stableToken: outputToken, cNgnToken: inputToken }
		}

		return null
	}

	private getStableType(normalizedAddress: string, chain: string): SupportedTokenType | null {
		if (normalizedAddress === this.configService.getUsdcAsset(chain).toLowerCase()) return "USDC"
		if (normalizedAddress === this.configService.getUsdtAsset(chain).toLowerCase()) return "USDT"
		return null
	}
}
