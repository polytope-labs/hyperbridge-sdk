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

			const destClient = this.clientManager.getPublicClient(chain)
			const walletAddress = privateKeyToAccount(this.privateKey).address as HexString
			const balanceCache = new Map<string, bigint>()

			// Compute USD value from the stable side (for price lookup).
			let stableUsdValue = new Decimal(0)
			for (let i = 0; i < order.inputs.length; i++) {
				const pair = this.classifyPair(order.inputs[i].token, order.output.assets[i].token, chain)!
				const sd =
					pair.stableType === "USDC"
						? this.configService.getUsdcDecimals(chain)
						: this.configService.getUsdtDecimals(chain)

				if (pair.inputIsStable) {
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

				if (pair.inputIsStable) {
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

				// Cap by actual available balance for this token on the filler side.
				const tokenAddress = bytes32ToBytes20(output.token).toLowerCase()
				let balance = balanceCache.get(tokenAddress)

				if (balance === undefined) {
					if (tokenAddress === ADDRESS_ZERO.toLowerCase()) {
						balance = await destClient.getBalance({ address: walletAddress })
					} else {
						balance = await destClient.readContract({
							abi: ERC20_ABI,
							address: tokenAddress as HexString,
							functionName: "balanceOf",
							args: [walletAddress],
						})
					}
					balanceCache.set(tokenAddress, balance)
				}

				const finalOutputAmount = balance > fillerMaxOutput ? fillerMaxOutput : balance

				if (finalOutputAmount === 0n) {
					this.logger.info(
						{
							orderId: order.id,
							token: output.token,
							fillerBalance: balance.toString(),
						},
						"Skipping order: no available balance for required output token",
					)
					return 0
				}

				// Decrement remaining balance for this token so repeated outputs share the same pool.
				const remaining = balance - finalOutputAmount
				balanceCache.set(tokenAddress, remaining > 0n ? remaining : 0n)

				fillerOutputs.push({ token: output.token, amount: finalOutputAmount })
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
