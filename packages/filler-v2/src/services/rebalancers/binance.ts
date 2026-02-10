import { Wallet, WalletRestAPI } from "@binance/wallet"
import { parseUnits, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { type HexString, parseStateMachineId } from "@hyperbridge/sdk"
import { ChainClientManager } from "../ChainClientManager"
import { FillerConfigService } from "../FillerConfigService"
import { getLogger, type Logger } from "../Logger"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { UnifiedRebalanceOptions } from "."

// ============================================================================
// Types
// ============================================================================

export interface BinanceCexConfig {
	apiKey: string
	apiSecret: string
	/** Base URL - defaults to https://api.binance.com */
	basePath?: string
	/** Timeout for Binance API requests in ms. Default: 5000 */
	timeout?: number
	/** Max time to wait for deposit confirmation (ms). Default: 5 min */
	depositTimeoutMs?: number
	/** Polling interval for deposit/withdrawal status (ms). Default: 15s */
	pollIntervalMs?: number
	/** Max time to wait for withdrawal completion (ms). Default: 10 min */
	withdrawTimeoutMs?: number
	/**
	 * Travel rule questionnaire for withdrawal, as a JSON-serializable object.
	 * Required for local entities (UAE, India, Japan, EU, etc.).
	 *
	 * For UAE (Dubai), self-transfer to own unhosted wallet:
	 *   { isAddressOwner: 1, sendTo: 1 }
	 *
	 * For UAE, sending to another person's unhosted wallet:
	 *   { isAddressOwner: 2, bnfType: 0, bnfName: "Name", country: "ae", city: "Dubai", sendTo: 1 }
	 *   Note: `city` is MANDATORY for UAE when isAddressOwner=2 (unlike India where it's optional)
	 *
	 * For UAE, sending to another person (corporate/entity):
	 *   { isAddressOwner: 2, bnfType: 1, bnfName: "Corp Name", country: "ae", city: "Dubai", sendTo: 1 }
	 *
	 * For UAE, sending to a VASP (exchange):
	 *   { isAddressOwner: 1, sendTo: 2, vasp: "BINANCE" }
	 *   For non-Binance VASPs: { isAddressOwner: 1, sendTo: 2, vasp: "others", vaspName: "Bybit" }
	 *
	 * See: https://developers.binance.com/docs/wallet/travel-rule/withdraw-questionnaire#uae
	 *
	 * If not provided, falls back to POST /sapi/v1/capital/withdraw/apply (non-travel-rule).
	 * Set to null to explicitly disable travel rule.
	 */
	travelRuleQuestionnaire?: Record<string, unknown> | null
}

export interface CexRebalanceResult {
	success: boolean
	depositTxHash: HexString
	/** For travel rule: this is the trId. For non-travel-rule: this is the withdrawal id. */
	withdrawalId: string
	amountDeposited: string
	amountReceived: string
	withdrawalFee: string
	elapsedMs: number
}

export interface CexRebalanceEstimate {
	withdrawalFee: string
	minWithdrawal: string
	withdrawEnabled: boolean
	depositEnabled: boolean
}

// ============================================================================
// Binance deposit history status codes
// Per GET /sapi/v1/capital/deposit/hisrec docs:
//   0 = pending, 6 = credited, 1 = success
// ============================================================================
const DEPOSIT_STATUS_SUCCESS = 1

// ============================================================================
// Binance withdrawal status codes
//
// For standard withdrawals (GET /sapi/v1/capital/withdraw/history):
//   0 = Email Sent, 2 = Awaiting Approval, 3 = Rejected,
//   4 = Processing, 5 = Failure, 6 = Completed
//
// For travel rule withdrawals (GET /sapi/v2/localentity/withdraw/history):
//   withdrawalStatus uses the same codes as above
//   travelRuleStatus: 0 = pending, 1 = approved, 2 = rejected
// ============================================================================
const WITHDRAW_STATUS_COMPLETED = 6
const WITHDRAW_STATUS_TERMINAL_FAILURES = new Set([1, 3, 5]) // cancelled, rejected, failure

// ============================================================================
// Chain ID <-> Binance Network Mapping
// ============================================================================
const CHAIN_ID_TO_BINANCE_NETWORK: Record<number, string> = {
	1: "ETH",
	56: "BSC",
	137: "MATIC",
	42161: "ARBITRUM",
	10: "OPTIMISM",
	8453: "BASE",
}

function getChainIdFromStateMachine(stateMachineId: string): number {
	const chainId = parseStateMachineId(stateMachineId).stateId.Evm
	if (chainId === undefined) {
		throw new Error(`${stateMachineId} is not an EVM chain`)
	}
	return chainId
}

function getBinanceNetwork(stateMachineId: string): string {
	const chainId = getChainIdFromStateMachine(stateMachineId)
	const network = CHAIN_ID_TO_BINANCE_NETWORK[chainId]
	if (!network) {
		throw new Error(
			`Chain ${stateMachineId} (chainId: ${chainId}) has no Binance network mapping. ` +
				`Supported: ${Object.entries(CHAIN_ID_TO_BINANCE_NETWORK)
					.map(([k, v]) => `${v}(${k})`)
					.join(", ")}`,
		)
	}
	return network
}

// ============================================================================
// BinanceRebalancer
// ============================================================================

/**
 * Handles cross-chain rebalancing via Binance CEX for chains not supported
 * by CCTP or USDT0 (e.g., BNB Chain).
 *
 * Supports travel rule compliance for local entities (India, Japan, EU, etc.)
 * via POST /sapi/v1/localentity/withdraw/apply when travelRuleQuestionnaire
 * is provided in config.
 *
 * Flow:
 * 1. Fetch deposit address via GET /sapi/v1/capital/deposit/address
 * 2. Transfer tokens on-chain from wallet → Binance deposit address
 * 3. Poll deposit history via GET /sapi/v1/capital/deposit/hisrec
 * 4. Submit withdrawal:
 *    - With travel rule: POST /sapi/v1/localentity/withdraw/apply (+ questionnaire)
 *    - Without travel rule: POST /sapi/v1/capital/withdraw/apply
 * 5. Poll withdrawal history:
 *    - With travel rule: GET /sapi/v2/localentity/withdraw/history
 *    - Without travel rule: GET /sapi/v1/capital/withdraw/history
 *
 * @example
 * ```typescript
 * const rebalancer = new BinanceRebalancer(
 *   chainClientManager,
 *   configService,
 *   privateKey,
 *   {
 *     apiKey: "...",
 *     apiSecret: "...",
 *     // UAE (Dubai): self-transfer to own wallet
 *     travelRuleQuestionnaire: { isAddressOwner: 1, sendTo: 1 },
 *   },
 * )
 *
 * const result = await rebalancer.sendViaCex({
 *   amount: "500.00",
 *   coin: "USDT",
 *   source: "EVM-56",
 *   destination: "EVM-42161",
 * })
 * ```
 */
export class BinanceRebalancer {
	private readonly walletClient: Wallet
	private readonly chainClientManager: ChainClientManager
	private readonly configService: FillerConfigService
	private readonly privateKey: HexString
	private readonly config: BinanceCexConfig
	private readonly logger: Logger
	private readonly depositTimeoutMs: number
	private readonly pollIntervalMs: number
	private readonly withdrawTimeoutMs: number
	private readonly travelRuleQuestionnaire: Record<string, unknown> | null

	constructor(
		chainClientManager: ChainClientManager,
		configService: FillerConfigService,
		privateKey: HexString,
		config: BinanceCexConfig,
	) {
		this.chainClientManager = chainClientManager
		this.configService = configService
		this.privateKey = privateKey
		this.config = config
		this.logger = getLogger("BinanceRebalancer")

		this.depositTimeoutMs = config.depositTimeoutMs ?? 20 * 60 * 1000
		this.pollIntervalMs = config.pollIntervalMs ?? 15_000
		this.withdrawTimeoutMs = config.withdrawTimeoutMs ?? 20 * 60 * 1000
		this.travelRuleQuestionnaire = config.travelRuleQuestionnaire ?? null

		this.walletClient = new Wallet({
			configurationRestAPI: {
				apiKey: config.apiKey,
				apiSecret: config.apiSecret,
				basePath: config.basePath,
				timeout: config.timeout ?? 5_000,
			},
		})
	}

	/** Whether this instance uses travel rule endpoints */
	private get useTravelRule(): boolean {
		return this.travelRuleQuestionnaire !== null
	}

	// ========================================================================
	// Public API
	// ========================================================================

	/**
	 * Full rebalance flow: deposit on-chain → wait for credit → withdraw to dest chain
	 */
	async sendViaCex(options: UnifiedRebalanceOptions): Promise<CexRebalanceResult> {
		const startTime = Date.now()
		const { amount, coin, source, destination } = options

		const sourceNetwork = getBinanceNetwork(source)
		const destNetwork = getBinanceNetwork(destination)

		this.logger.info(
			{ amount, coin, source: sourceNetwork, destination: destNetwork, travelRule: this.useTravelRule },
			"Starting CEX rebalance",
		)

		const depositResp = await this.walletClient.restAPI
			.depositAddress({ coin, network: sourceNetwork })
			.then((res) => res.data())

		const depositAddress = depositResp.address
		if (!depositAddress) {
			throw new Error(`Binance did not return a deposit address for ${coin} on network ${sourceNetwork}`)
		}
		this.logger.info({ depositAddress, network: sourceNetwork }, "Got deposit address")

		const depositTxHash = await this.transferOnChain(source, coin, amount, depositAddress)
		this.logger.info({ depositTxHash }, "On-chain deposit transfer sent")

		await this.waitForDepositCredit(coin, depositTxHash)
		this.logger.info("Deposit credited on Binance")

		const account = privateKeyToAccount(this.privateKey as `0x${string}`)
		let withdrawalId: string

		if (this.useTravelRule) {
			withdrawalId = await this.withdrawWithTravelRule(coin, account.address, amount, destNetwork)
		} else {
			withdrawalId = await this.withdrawStandard(coin, account.address, amount, destNetwork)
		}

		this.logger.info({ withdrawalId, travelRule: this.useTravelRule }, "Withdrawal initiated")

		const finalWithdrawal = this.useTravelRule
			? await this.waitForTravelRuleWithdrawalComplete(withdrawalId)
			: await this.waitForStandardWithdrawalComplete(withdrawalId)

		const elapsedMs = Date.now() - startTime
		const result: CexRebalanceResult = {
			success: true,
			depositTxHash,
			withdrawalId,
			amountDeposited: amount,
			amountReceived: finalWithdrawal.amount,
			withdrawalFee: finalWithdrawal.transactionFee,
			elapsedMs,
		}

		this.logger.info({ ...result, elapsedSeconds: Math.round(elapsedMs / 1000) }, "CEX rebalance completed")

		return result
	}

	/**
	 * Estimate costs for a CEX rebalance.
	 */
	async estimateCexRebalance(options: UnifiedRebalanceOptions): Promise<CexRebalanceEstimate> {
		const { coin, source, destination } = options
		const destNetwork = getBinanceNetwork(destination)
		const sourceNetwork = getBinanceNetwork(source)

		const allCoins: WalletRestAPI.AllCoinsInformationResponse = await this.walletClient.restAPI
			.allCoinsInformation()
			.then((res) => res.data())

		const coinInfo = allCoins.find((c) => c.coin === coin)
		if (!coinInfo) {
			throw new Error(`Coin ${coin} not found on Binance`)
		}

		const destNetworkInfo = coinInfo.networkList?.find((n: any) => n.network === destNetwork)
		const sourceNetworkInfo = coinInfo.networkList?.find((n: any) => n.network === sourceNetwork)

		if (
			!destNetworkInfo ||
			!sourceNetworkInfo ||
			destNetworkInfo.withdrawFee === undefined ||
			destNetworkInfo.withdrawMin === undefined ||
			destNetworkInfo.withdrawEnable === undefined ||
			sourceNetworkInfo.depositEnable === undefined
		) {
			throw new Error(
				`Incomplete network configuration for ${coin} on Binance. ` +
					`destNetwork=${destNetwork}, sourceNetwork=${sourceNetwork}`,
			)
		}

		return {
			withdrawalFee: destNetworkInfo.withdrawFee,
			minWithdrawal: destNetworkInfo.withdrawMin,
			withdrawEnabled: destNetworkInfo.withdrawEnable,
			depositEnabled: sourceNetworkInfo.depositEnable,
		}
	}

	// ========================================================================
	// Withdrawal methods
	// ========================================================================

	/**
	 * Standard withdrawal via POST /sapi/v1/capital/withdraw/apply
	 * Response: { id: "7213fea8e94b4a5593d507237e5a555b" }
	 */
	private async withdrawStandard(coin: string, address: string, amount: string, network: string): Promise<string> {
		const resp = await this.walletClient.restAPI
			.withdraw({
				coin,
				address,
				amount: Number(amount),
				network,
			})
			.then((res) => res.data())

		const id = resp.id
		if (!id) {
			throw new Error("Binance did not return a withdrawal id")
		}
		return id
	}

	/**
	 * Travel rule withdrawal via POST /sapi/v1/localentity/withdraw/apply
	 * using `this.walletClient.restAPI.withdrawTravelRule()`.
	 *
	 * Same params as standard withdraw + mandatory `questionnaire` (JSON string).
	 * The questionnaire must match your local entity (UAE, India, Japan, etc).
	 *
	 * Response: { trId: 123456, accpted: true, info: "Withdraw request accepted" }
	 * Note: "accpted" is Binance's actual spelling, not a typo on our side.
	 *
	 * Returns the trId as string for tracking via
	 * GET /sapi/v2/localentity/withdraw/history
	 */
	private async withdrawWithTravelRule(
		coin: string,
		address: string,
		amount: string,
		network: string,
	): Promise<string> {
		const questionnaire = JSON.stringify(this.travelRuleQuestionnaire)

		this.logger.debug({ questionnaire, coin, network, address }, "Submitting travel rule withdrawal")

		const resp = await this.walletClient.restAPI
			.withdrawTravelRule({
				coin,
				address,
				amount: Number(amount),
				network,
				questionnaire,
			})
			.then((res) => res.data())

		this.logger.debug({ resp }, "Travel rule withdrawal response")

		// Response: { trId: 123456, accpted: true, info: "..." }
		if ((resp as any).accpted === false) {
			throw new Error(`Travel rule withdrawal rejected: ${(resp as any).info || "unknown reason"}`)
		}

		const trId = (resp as any).trId
		if (trId === undefined || trId === null) {
			throw new Error(
				`Binance did not return a trId for travel rule withdrawal. Response: ${JSON.stringify(resp)}`,
			)
		}

		return String(trId)
	}

	// ========================================================================
	// Withdrawal polling methods
	// ========================================================================

	/**
	 * Polls GET /sapi/v1/capital/withdraw/history for standard withdrawals.
	 * Matches by `id` field.
	 */
	private async waitForStandardWithdrawalComplete(
		withdrawalId: string,
	): Promise<{ amount: string; transactionFee: string; txId: string }> {
		const startTime = Date.now()

		while (Date.now() - startTime < this.withdrawTimeoutMs) {
			try {
				const withdrawals: WalletRestAPI.WithdrawHistoryResponse = await this.walletClient.restAPI
					.withdrawHistory({})
					.then((res) => res.data())

				const match = withdrawals.find((w) => w.id === withdrawalId)

				if (match) {
					if (match.status === WITHDRAW_STATUS_COMPLETED) {
						const { amount, transactionFee, txId } = match
						if (!amount || !transactionFee || !txId) {
							throw new Error(
								`Withdrawal ${withdrawalId} completed but missing fields: ` +
									`amount=${amount}, transactionFee=${transactionFee}, txId=${txId}`,
							)
						}
						this.logger.debug({ txId }, "Standard withdrawal completed")
						return { amount, transactionFee, txId }
					}

					const status = match.status
					if (status !== undefined && WITHDRAW_STATUS_TERMINAL_FAILURES.has(Number(status))) {
						throw new Error(
							`Withdrawal ${withdrawalId} failed with status ${status}` +
								(match.info ? `: ${match.info}` : ""),
						)
					}

					this.logger.debug({ status }, "Standard withdrawal in progress")
				}
			} catch (error) {
				if (error instanceof Error && error.message.includes("failed with status")) {
					throw error
				}
				this.logger.warn({ error }, "Error polling standard withdrawal status, retrying...")
			}

			await this.sleep(this.pollIntervalMs)
		}

		throw new Error(`Withdrawal ${withdrawalId} not completed within ${this.withdrawTimeoutMs / 60000} minutes.`)
	}

	/**
	 * Polls GET /sapi/v2/localentity/withdraw/history for travel rule withdrawals.
	 *
	 * NOTE: The @binance/wallet connector does not expose a method for
	 * travel rule withdraw history. We use signedRequest() as a fallback
	 * for this single endpoint. If the connector adds support in the future,
	 * this should be migrated.
	 *
	 * Response uses different field names than standard:
	 *   - trId: travel rule record ID (what we match on)
	 *   - withdrawalStatus: same codes as standard (0/2/3/4/5/6)
	 *   - travelRuleStatus: 0=pending, 1=approved, 2=rejected
	 *   - amount, transactionFee, txId, coin, network, etc.
	 *
	 * Note: Withdrawals made via /sapi/v1/capital/withdraw/apply do NOT appear here.
	 */
	private async waitForTravelRuleWithdrawalComplete(
		trId: string,
	): Promise<{ amount: string; transactionFee: string; txId: string }> {
		const startTime = Date.now()
		const trIdNum = Number(trId)

		while (Date.now() - startTime < this.withdrawTimeoutMs) {
			try {
				// GET /sapi/v2/localentity/withdraw/history
				const withdrawals: any[] = await this.signedRequest("GET", "/sapi/v2/localentity/withdraw/history", {})

				const match = withdrawals.find((w: any) => w.trId === trIdNum || String(w.trId) === trId)

				if (match) {
					const withdrawalStatus = match.withdrawalStatus
					const travelRuleStatus = match.travelRuleStatus

					this.logger.debug({ trId, withdrawalStatus, travelRuleStatus }, "Travel rule withdrawal status")

					// Travel rule rejection
					if (travelRuleStatus === 2) {
						throw new Error(
							`Travel rule rejected for trId=${trId}. ` +
								(match.info ? `Reason: ${match.info}` : "Check Binance UI for details."),
						)
					}

					// Withdrawal completed
					if (withdrawalStatus === WITHDRAW_STATUS_COMPLETED) {
						const amount = match.amount
						const transactionFee = match.transactionFee
						const txId = match.txId

						if (!amount || !txId) {
							throw new Error(
								`Travel rule withdrawal trId=${trId} completed but missing fields: ` +
									`amount=${amount}, transactionFee=${transactionFee}, txId=${txId}`,
							)
						}

						this.logger.debug({ txId, trId }, "Travel rule withdrawal completed")
						return {
							amount,
							transactionFee: transactionFee || "0",
							txId,
						}
					}

					// Terminal withdrawal failure
					if (
						withdrawalStatus !== undefined &&
						WITHDRAW_STATUS_TERMINAL_FAILURES.has(Number(withdrawalStatus))
					) {
						throw new Error(
							`Travel rule withdrawal trId=${trId} failed with withdrawalStatus=${withdrawalStatus}` +
								(match.info ? `: ${match.info}` : ""),
						)
					}
				} else {
					this.logger.debug({ trId }, "Travel rule withdrawal not yet in history")
				}
			} catch (error) {
				if (
					error instanceof Error &&
					(error.message.includes("failed with") || error.message.includes("rejected"))
				) {
					throw error
				}
				this.logger.warn({ error }, "Error polling travel rule withdrawal status, retrying...")
			}

			await this.sleep(this.pollIntervalMs)
		}

		throw new Error(
			`Travel rule withdrawal trId=${trId} not completed within ${this.withdrawTimeoutMs / 60000} minutes.`,
		)
	}

	// ========================================================================
	// On-chain deposit transfer
	// ========================================================================

	private async transferOnChain(
		source: string,
		coin: "USDC" | "USDT",
		amount: string,
		toAddress: string,
	): Promise<HexString> {
		const publicClient = this.chainClientManager.getPublicClient(source)
		const walletClient = this.chainClientManager.getWalletClient(source)

		const tokenAddress =
			coin === "USDC" ? this.configService.getUsdcAsset(source) : this.configService.getUsdtAsset(source)

		if (!tokenAddress || tokenAddress === "0x") {
			throw new Error(`${coin} not configured for chain ${source}`)
		}

		const tokenDecimals = await publicClient.readContract({
			address: tokenAddress as `0x${string}`,
			abi: ERC20_ABI,
			functionName: "decimals",
		})

		const amountWei = parseUnits(amount, Number(tokenDecimals))

		const balance = await publicClient.readContract({
			address: tokenAddress as `0x${string}`,
			abi: ERC20_ABI,
			functionName: "balanceOf",
			args: [walletClient.account!.address],
		})

		if (balance < amountWei) {
			throw new Error(`Insufficient ${coin} balance on ${source}: have ${balance}, need ${amountWei}`)
		}

		const txHash = await walletClient.writeContract({
			address: tokenAddress as `0x${string}`,
			abi: ERC20_ABI,
			functionName: "transfer",
			args: [toAddress as `0x${string}`, amountWei],
			account: walletClient.account!,
			chain: walletClient.chain,
		})

		const receipt = await publicClient.waitForTransactionReceipt({
			hash: txHash,
			confirmations: 2,
		})

		if (receipt.status !== "success") {
			throw new Error(`On-chain transfer to Binance failed: tx ${txHash}`)
		}

		return txHash
	}

	// ========================================================================
	// Raw signed request (for travel rule history — not exposed by connector)
	// ========================================================================

	/**
	 * Makes a raw HMAC-SHA256 signed request to Binance SAPI.
	 * Only used for the travel rule withdraw history endpoint which
	 * @binance/wallet does not expose:
	 *   - GET /sapi/v2/localentity/withdraw/history
	 *
	 * All other endpoints use the connector directly.
	 */
	private async signedRequest(
		method: "GET" | "POST",
		path: string,
		params: Record<string, string | number>,
	): Promise<any> {
		const { createHmac } = await import("crypto")

		const basePath = this.config.basePath || "https://api.binance.com"
		const apiKey = this.config.apiKey
		const apiSecret = this.config.apiSecret

		const timestamp = Date.now().toString()
		const queryParams = new URLSearchParams()

		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				queryParams.append(key, String(value))
			}
		}
		queryParams.append("timestamp", timestamp)
		queryParams.append("recvWindow", "5000")

		const signature = createHmac("sha256", apiSecret).update(queryParams.toString()).digest("hex")

		queryParams.append("signature", signature)

		const url = method === "GET" ? `${basePath}${path}?${queryParams.toString()}` : `${basePath}${path}`

		const fetchOptions: RequestInit = {
			method,
			headers: {
				"X-MBX-APIKEY": apiKey,
				"Content-Type": "application/x-www-form-urlencoded",
			},
		}

		if (method === "POST") {
			fetchOptions.body = queryParams.toString()
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const body = await response.text()
			let errorMsg: string
			try {
				const parsed = JSON.parse(body)
				errorMsg = `Binance API error [${path}]: ${parsed.code} - ${parsed.msg}`
			} catch {
				errorMsg = `Binance API error [${path}]: ${response.status} ${response.statusText} - ${body}`
			}
			throw new Error(errorMsg)
		}

		return response.json()
	}

	// ========================================================================
	// Helpers
	// ========================================================================

	async waitForDepositCredit(coin: string, txHash: string): Promise<void> {
		const startTime = Date.now()
		const normalizedTxHash = txHash.toLowerCase()

		while (Date.now() - startTime < this.depositTimeoutMs) {
			try {
				const deposits: WalletRestAPI.DepositHistoryResponse = await this.walletClient.restAPI
					.depositHistory({
						coin,
					})
					.then((res) => res.data())

				const match = deposits.find((d) => {
					const dTxId = (d.txId || "").toLowerCase()
					return (
						dTxId === normalizedTxHash ||
						dTxId === normalizedTxHash.replace("0x", "") ||
						`0x${dTxId}` === normalizedTxHash
					)
				})

				if (match) {
					if (match.status === DEPOSIT_STATUS_SUCCESS) {
						this.logger.debug({ confirmTimes: match.confirmTimes }, "Deposit fully confirmed")
						return
					}
					this.logger.debug(
						{ status: match.status, confirmTimes: match.confirmTimes },
						"Deposit found, waiting for confirmation",
					)
				} else {
					this.logger.debug("Deposit not yet visible in Binance history")
				}
			} catch (error) {
				this.logger.warn({ error }, "Error polling deposit status, retrying...")
			}

			await this.sleep(this.pollIntervalMs)
		}

		throw new Error(
			`Deposit not confirmed within ${this.depositTimeoutMs / 60000} minutes. ` +
				`txHash: ${txHash}. Check Binance deposit history manually.`,
		)
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
