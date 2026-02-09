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
	/** Max time to wait for deposit confirmation (ms). Default: 30 min */
	depositTimeoutMs?: number
	/** Polling interval for deposit/withdrawal status (ms). Default: 15s */
	pollIntervalMs?: number
	/** Max time to wait for withdrawal completion (ms). Default: 60 min */
	withdrawTimeoutMs?: number
}

export interface CexRebalanceResult {
	success: boolean
	depositTxHash: HexString
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
// Per GET /sapi/v1/capital/withdraw/history docs:
//   0 = Email Sent, 2 = Awaiting Approval, 3 = Rejected,
//   4 = Processing, 5 = Failure, 6 = Completed
// ============================================================================
const WITHDRAW_STATUS_COMPLETED = 6
const WITHDRAW_STATUS_TERMINAL_FAILURES = new Set([1, 3, 5]) // cancelled, rejected, failure

// ============================================================================
// Chain ID <-> Binance Network Mapping
//
// IMPORTANT: These are the `network` parameter values Binance uses.
// Verify against GET /sapi/v1/capital/config/getall for your account,
// as Binance can change these. The `networkList[].network` field in that
// response is the authoritative source.
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
 * Uses the official @binance/wallet connector (npm: @binance/wallet)
 * for all Binance API interactions. The connector handles HMAC-SHA256
 * signing, timestamps, and recvWindow internally.
 *
 * Flow:
 * 1. Fetch deposit address via GET /sapi/v1/capital/deposit/address
 * 2. Transfer tokens on-chain from wallet → Binance deposit address
 * 3. Poll deposit history via GET /sapi/v1/capital/deposit/hisrec
 * 4. Submit withdrawal via POST /sapi/v1/capital/withdraw/apply
 * 5. Poll withdrawal history via GET /sapi/v1/capital/withdraw/history
 *
 * Prerequisites:
 * - API key must have "Enable Withdrawals" permission
 * - API key should have IP restriction enabled (recommended)
 * - Destination wallet address must be whitelisted in Binance UI first
 * - Travel Rule: Check GET /sapi/v1/localentity/questionnaire-requirements —
 *   if it returns non-NIL, use POST /sapi/v1/localentity/withdraw/apply instead
 *   of POST /sapi/v1/capital/withdraw/apply
 *
 * @example
 * ```typescript
 * const rebalancer = new BinanceRebalancer(
 *   chainClientManager,
 *   configService,
 *   privateKey,
 *   { apiKey: "...", apiSecret: "..." },
 * )
 *
 * // Rebalance USDT from BNB Chain to Arbitrum
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
	private readonly logger: Logger
	private readonly depositTimeoutMs: number
	private readonly pollIntervalMs: number
	private readonly withdrawTimeoutMs: number

	constructor(
		chainClientManager: ChainClientManager,
		configService: FillerConfigService,
		privateKey: HexString,
		config: BinanceCexConfig,
	) {
		this.chainClientManager = chainClientManager
		this.configService = configService
		this.privateKey = privateKey
		this.logger = getLogger("BinanceRebalancer")

		this.depositTimeoutMs = config.depositTimeoutMs ?? 30 * 60 * 1000
		this.pollIntervalMs = config.pollIntervalMs ?? 15_000
		this.withdrawTimeoutMs = config.withdrawTimeoutMs ?? 60 * 60 * 1000

		// Initialize official @binance/wallet connector
		// Auth (HMAC-SHA256 signing) is handled internally by the connector
		this.walletClient = new Wallet({
			configurationRestAPI: {
				apiKey: config.apiKey,
				apiSecret: config.apiSecret,
				basePath: config.basePath, // defaults to https://api.binance.com
				timeout: config.timeout ?? 5_000,
			},
		})
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

		this.logger.info({ amount, coin, source: sourceNetwork, destination: destNetwork }, "Starting CEX rebalance")

		// GET /sapi/v1/capital/deposit/address
		// Params: coin (required), network (optional, returns default if not sent)
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

		// Polls GET /sapi/v1/capital/deposit/hisrec
		await this.waitForDepositCredit(coin, depositTxHash)
		this.logger.info("Deposit credited on Binance")

		// POST /sapi/v1/capital/withdraw/apply
		// Required params: coin, address, amount
		// Optional: network (if not sent, uses default network for the coin),
		//           withdrawOrderId (client-side ID for later query),
		//           walletType (0=spot, 1=funding, default=current selected)
		const account = privateKeyToAccount(this.privateKey as `0x${string}`)
		const withdrawResp = await this.walletClient.restAPI
			.withdraw({
				coin,
				address: account.address,
				amount: Number(amount),
				network: destNetwork,
			})
			.then((res) => res.data())

		// Response: { id: "7213fea8e94b4a5593d507237e5a555b" }
		const withdrawalId = withdrawResp.id
		if (!withdrawalId) {
			throw new Error("Binance did not return a withdrawal id")
		}
		this.logger.info({ withdrawalId }, "Withdrawal initiated")

		// Polls GET /sapi/v1/capital/withdraw/history
		const finalWithdrawal = await this.waitForWithdrawalComplete(withdrawalId)

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
	 * Uses GET /sapi/v1/capital/config/getall to fetch all coin info
	 * including networkList with fees, minimums, and enable flags.
	 */
	async estimateCexRebalance(options: UnifiedRebalanceOptions): Promise<CexRebalanceEstimate> {
		const { coin, source, destination } = options
		const destNetwork = getBinanceNetwork(destination)
		const sourceNetwork = getBinanceNetwork(source)

		// GET /sapi/v1/capital/config/getall — returns all coins with their network info
		// Each coin has: networkList[].{network, withdrawFee, withdrawMin, withdrawEnable, depositEnable, ...}
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
	// On-chain deposit transfer
	// ========================================================================

	/**
	 * Sends an ERC20 transfer on-chain to the Binance deposit address.
	 * Uses the existing ChainClientManager/viem infrastructure.
	 */
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

		// Verify balance before sending
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
			confirmations: 2, // Extra confirmation for CEX deposits
		})

		if (receipt.status !== "success") {
			throw new Error(`On-chain transfer to Binance failed: tx ${txHash}`)
		}

		return txHash
	}

	// ========================================================================
	// Polling / Waiting
	// ========================================================================

	/**
	 * Polls GET /sapi/v1/capital/deposit/hisrec until deposit is confirmed.
	 *
	 * Deposit status codes per Binance docs:
	 *   0 = pending
	 *   6 = credited to account
	 *   1 = success (final)
	 *
	 * Response fields we use:
	 *   txId - transaction hash (may not have 0x prefix)
	 *   status - status code
	 *   confirmTimes - e.g. "12/12"
	 */
	private async waitForDepositCredit(coin: string, txHash: string): Promise<void> {
		const startTime = Date.now()
		const normalizedTxHash = txHash.toLowerCase()

		while (Date.now() - startTime < this.depositTimeoutMs) {
			try {
				// startTime/endTime interval must be < 90 days
				const deposits: WalletRestAPI.DepositHistoryResponse = await this.walletClient.restAPI
					.depositHistory({
						coin,
						startTime: startTime - 5 * 60 * 1000, // 5 min before we started
					})
					.then((res) => res.data())

				// Match by txId — Binance may store without 0x prefix or lowercased
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

	/**
	 * Polls GET /sapi/v1/capital/withdraw/history until withdrawal completes or fails.
	 *
	 * Withdrawal status codes per Binance docs:
	 *   0 = Email Sent
	 *   2 = Awaiting Approval
	 *   3 = Rejected
	 *   4 = Processing
	 *   5 = Failure
	 *   6 = Completed
	 *
	 * Response fields we use:
	 *   id - withdrawal ID (matches the id from POST /withdraw/apply response)
	 *   amount - withdrawal amount
	 *   transactionFee - fee charged
	 *   status - status code
	 *   txId - on-chain tx hash (available once completed)
	 *   info - failure reason text (when applicable)
	 *
	 * Note: Default time range is last 90 days. If using withdrawOrderId filter,
	 * time range must be < 7 days. Max limit is 1000 records.
	 */
	private async waitForWithdrawalComplete(
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
								`Withdrawal ${withdrawalId} completed but response is missing fields: ` +
									`amount=${amount}, transactionFee=${transactionFee}, txId=${txId}`,
							)
						}

						this.logger.debug({ txId: match.txId }, "Withdrawal completed")
						return {
							amount,
							transactionFee,
							txId,
						}
					}

					const status = match.status
					if (status !== undefined && WITHDRAW_STATUS_TERMINAL_FAILURES.has(Number(status))) {
						throw new Error(
							`Withdrawal ${withdrawalId} failed with status ${status}` +
								(match.info ? `: ${match.info}` : ""),
						)
					}

					// Status 0, 2, or 4 = still in progress
					this.logger.debug({ status: match.status }, "Withdrawal in progress")
				}
			} catch (error) {
				if (error instanceof Error && error.message.includes("failed with status")) {
					throw error
				}
				this.logger.warn({ error }, "Error polling withdrawal status, retrying...")
			}

			await this.sleep(this.pollIntervalMs)
		}

		throw new Error(
			`Withdrawal ${withdrawalId} not completed within ${this.withdrawTimeoutMs / 60000} minutes. ` +
				`Check Binance withdrawal history manually.`,
		)
	}

	// ========================================================================
	// Helpers
	// ========================================================================

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
