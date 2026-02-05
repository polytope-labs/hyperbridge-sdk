import { BridgeKit, isKitError, isRetryableError, getErrorMessage } from "@circle-fin/bridge-kit"
import type { BridgeResult, BridgeParams, EstimateResult } from "@circle-fin/bridge-kit"
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2"
import type { Chain, PublicClient } from "viem"
import { parseUnits, padHex, maxUint256 } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { type HexString, parseStateMachineId } from "@hyperbridge/sdk"
import { ChainClientManager } from "./ChainClientManager"
import { FillerConfigService } from "./FillerConfigService"
import { getLogger, type Logger } from "./Logger"
import { OFT_ABI } from "@/config/abis/Oft"
import { ERC20_ABI } from "@/config/abis/ERC20"

/** Viem adapter type */
type ViemAdapter = ReturnType<typeof createViemAdapterFromPrivateKey>

/**
 * Options for making a CCTP or USDT0 transfer
 */
export interface RebalanceOptions {
	/** Amount in human-readable format (e.g., "100.00" for 100 USDC) */
	amount: string
	/** Source chain in state machine format (e.g., "EVM-137") */
	source: string
	/** Destination chain in state machine format (e.g., "EVM-42161") */
	destination: string
	/** Optional recipient address (defaults to sender's address) */
	recipientAddress?: HexString
}

/**
 * Maps EVM chain IDs to CCTP chain names used by Bridge Kit
 */
const CHAIN_ID_TO_CCTP: Record<number, string> = {
	1: "Ethereum",
	11155111: "Ethereum_Sepolia",
	42161: "Arbitrum",
	421614: "Arbitrum_Sepolia",
	8453: "Base",
	84532: "Base_Sepolia",
	10: "Optimism",
	11155420: "Optimism_Sepolia",
	137: "Polygon",
	80002: "Polygon_Amoy_Testnet",
	130: "Unichain",
	1301: "Unichain_Sepolia",
}

/**
 * Converts state machine ID to CCTP chain name
 */
function stateMachineToCctpChain(stateMachineId: string): string {
	const chainId = parseStateMachineId(stateMachineId).stateId.Evm
	if (chainId === undefined) {
		throw new Error(`Chain ${stateMachineId} is not an EVM chain`)
	}
	const cctpChain = CHAIN_ID_TO_CCTP[chainId]
	if (!cctpChain) {
		throw new Error(`Chain ${stateMachineId} (chainId: ${chainId}) is not supported by CCTP`)
	}
	return cctpChain
}

/**
 * Result of a USDT0 transfer
 */
export interface Usdt0TransferResult {
	success: boolean
	txHash: HexString
	amountSent: bigint
	amountReceived: bigint
	nativeFee: bigint
}

/**
 * Estimate result for USDT0 transfer
 */
export interface Usdt0EstimateResult {
	amountSent: bigint
	amountReceived: bigint
	nativeFee: bigint
	minAmount: bigint
	maxAmount: bigint
}

/**
 * RebalancingService - Cross-chain USDC/USDT0 transfers using Circle's CCTP and LayerZero OFT
 *
 * @example
 * ```typescript
 * const service = new RebalancingService(chainClientManager, configService, privateKey)
 *
 * // USDC via CCTP
 * await service.sendCctp({
 *   amount: "100.00",
 *   source: "EVM-137",      // Polygon
 *   destination: "EVM-42161", // Arbitrum
 * })
 *
 * // USDT0 via LayerZero OFT
 * await service.sendUsdt0({
 *   amount: "100.00",
 *   source: "EVM-1",        // Ethereum
 *   destination: "EVM-42161", // Arbitrum
 * })
 * ```
 */
export class RebalancingService {
	private bridgeKit: BridgeKit
	private adapter: ViemAdapter | null = null
	private chainClientManager: ChainClientManager
	private configService: FillerConfigService
	private privateKey: HexString
	private logger: Logger

	constructor(chainClientManager: ChainClientManager, configService: FillerConfigService, privateKey: HexString) {
		this.chainClientManager = chainClientManager
		this.configService = configService
		this.privateKey = privateKey
		this.bridgeKit = new BridgeKit()
		this.logger = getLogger("RebalancingService")
	}

	/**
	 * Creates the viem adapter lazily, using existing public clients from ChainClientManager
	 */
	private getAdapter(): ViemAdapter {
		if (this.adapter) return this.adapter

		this.adapter = createViemAdapterFromPrivateKey({
			privateKey: this.privateKey,
			getPublicClient: ({ chain }: { chain: Chain }) => {
				// Use existing public client from ChainClientManager
				const stateMachineId = `EVM-${chain.id}`
				return this.chainClientManager.getPublicClient(stateMachineId) as PublicClient
			},
		})

		return this.adapter
	}

	/**
	 * Sends USDC cross-chain using CCTP
	 */
	async sendCctp(options: RebalanceOptions): Promise<BridgeResult> {
		const { amount, source, destination, recipientAddress } = options

		const sourceChain = stateMachineToCctpChain(source)
		const destChain = stateMachineToCctpChain(destination)

		this.logger.info({ amount, source: sourceChain, destination: destChain }, "Initiating CCTP transfer")

		const adapter = this.getAdapter()

		const bridgeParams = {
			from: { adapter, chain: sourceChain },
			to: recipientAddress ? { adapter, chain: destChain, recipientAddress } : { adapter, chain: destChain },
			amount,
		} as BridgeParams

		try {
			const result = await this.bridgeKit.bridge(bridgeParams)

			if (result.state === "success") {
				this.logger.info({ amount, source: sourceChain, destination: destChain }, "CCTP transfer completed")
			} else {
				this.logger.error({ state: result.state, steps: result.steps }, "CCTP transfer failed")
			}

			return result
		} catch (error) {
			this.logger.error({ error: getErrorMessage(error) }, "CCTP transfer error")

			if (isKitError(error) && isRetryableError(error)) {
				this.logger.info("Error is retryable")
			}

			throw error
		}
	}

	/**
	 * Estimates the cost of a CCTP transfer
	 */
	async estimateCctp(options: RebalanceOptions): Promise<EstimateResult> {
		const { amount, source, destination, recipientAddress } = options

		const sourceChain = stateMachineToCctpChain(source)
		const destChain = stateMachineToCctpChain(destination)

		const adapter = this.getAdapter()

		const bridgeParams = {
			from: { adapter, chain: sourceChain },
			to: recipientAddress ? { adapter, chain: destChain, recipientAddress } : { adapter, chain: destChain },
			amount,
		} as BridgeParams

		return this.bridgeKit.estimate(bridgeParams)
	}

	/**
	 * Retries a failed CCTP transfer
	 */
	async retrySendCctp(failedResult: BridgeResult): Promise<BridgeResult> {
		if (failedResult.state !== "error") {
			throw new Error("Can only retry failed transfers")
		}

		this.logger.info(
			{
				source: failedResult.source.chain.chain,
				destination: failedResult.destination.chain.chain,
				amount: failedResult.amount,
			},
			"Retrying failed CCTP transfer",
		)

		const adapter = this.getAdapter()

		try {
			const result = await this.bridgeKit.retry(failedResult, {
				from: adapter,
				to: adapter,
			})

			if (result.state === "success") {
				this.logger.info("CCTP retry completed successfully")
			} else {
				this.logger.error({ state: result.state, steps: result.steps }, "CCTP retry failed")
			}

			return result
		} catch (error) {
			this.logger.error({ error: getErrorMessage(error) }, "CCTP retry error")
			throw error
		}
	}

	// ============================================================================
	// USDT0 (LayerZero OFT) Methods
	// ============================================================================

	/**
	 * Sends USDT0 cross-chain using LayerZero OFT
	 */
	async sendUsdt0(options: RebalanceOptions): Promise<Usdt0TransferResult> {
		const { amount, source, destination, recipientAddress } = options

		const sourceChainId = parseStateMachineId(source).stateId.Evm

		const destEid = this.configService.getLayerZeroEid(destination)
		if (!destEid) {
			throw new Error(`Chain ${destination} is not supported by USDT0 (no LayerZero EID configured)`)
		}

		const oftAddress = this.configService.getUsdt0OftAddress(source)
		const tokenAddress = this.configService.getUsdtAsset(source)
		if (!oftAddress) {
			throw new Error(`Chain ${source} is not supported by USDT0 (no OFT address configured)`)
		}
		if (!tokenAddress || tokenAddress === "0x") {
			throw new Error(`Chain ${source} does not have USDT configured`)
		}

		this.logger.info({ amount, source, destination, destEid }, "Initiating USDT0 transfer")

		const publicClient = this.chainClientManager.getPublicClient(source)
		const walletClient = this.chainClientManager.getWalletClient(source)
		const account = privateKeyToAccount(this.privateKey as `0x${string}`)
		const recipient = recipientAddress || account.address

		// Parse amount (USDT0 has 6 decimals)
		const amountWei = parseUnits(amount, 6)

		// Approve OFT contract to spend tokens (only needed on Ethereum)
		if (sourceChainId === 1) {
			const allowance = await publicClient.readContract({
				address: tokenAddress as `0x${string}`,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [account.address, oftAddress],
			})

			if (allowance < amountWei) {
				this.logger.debug({ tokenAddress, oftAddress }, "Approving USDT for OFT")
				const approveTx = await walletClient.writeContract({
					address: tokenAddress as `0x${string}`,
					abi: ERC20_ABI,
					functionName: "approve",
					args: [oftAddress, maxUint256],
					account,
					chain: walletClient.chain,
				})
				await publicClient.waitForTransactionReceipt({ hash: approveTx, confirmations: 1 })
				this.logger.debug({ txHash: approveTx }, "USDT approved")
			}
		}

		// Build send params
		const recipientBytes32 = padHex(recipient, { size: 32 })
		const sendParam = {
			dstEid: destEid,
			to: recipientBytes32,
			amountLD: amountWei,
			minAmountLD: 0n,
			extraOptions: "0x" as HexString,
			composeMsg: "0x" as HexString,
			oftCmd: "0x" as HexString,
		}

		// Quote OFT to get minimum amount
		const [, , oftReceipt] = await publicClient.readContract({
			address: oftAddress,
			abi: OFT_ABI,
			functionName: "quoteOFT",
			args: [sendParam],
		})

		// Update minAmountLD with the quoted amount
		sendParam.minAmountLD = oftReceipt.amountReceivedLD

		// Quote messaging fee
		const msgFee = await publicClient.readContract({
			address: oftAddress,
			abi: OFT_ABI,
			functionName: "quoteSend",
			args: [sendParam, false],
		})

		this.logger.debug({ nativeFee: msgFee.nativeFee.toString() }, "LayerZero messaging fee")

		// Execute send
		const txHash = await walletClient.writeContract({
			address: oftAddress,
			abi: OFT_ABI,
			functionName: "send",
			args: [sendParam, msgFee, recipient],
			value: msgFee.nativeFee,
			account,
			chain: walletClient.chain,
		})

		const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })

		this.logger.info(
			{
				txHash,
				amountSent: oftReceipt.amountSentLD.toString(),
				amountReceived: oftReceipt.amountReceivedLD.toString(),
			},
			"USDT0 transfer initiated",
		)

		return {
			success: receipt.status === "success",
			txHash,
			amountSent: oftReceipt.amountSentLD,
			amountReceived: oftReceipt.amountReceivedLD,
			nativeFee: msgFee.nativeFee,
		}
	}

	/**
	 * Estimates the cost of a USDT0 transfer
	 */
	async estimateUsdt0(options: RebalanceOptions): Promise<Usdt0EstimateResult> {
		const { amount, source, destination, recipientAddress } = options

		const destEid = this.configService.getLayerZeroEid(destination)
		if (!destEid) {
			throw new Error(`Chain ${destination} is not supported by USDT0 (no LayerZero EID configured)`)
		}

		const oftAddress = this.configService.getUsdt0OftAddress(source)
		if (!oftAddress) {
			throw new Error(`Chain ${source} is not supported by USDT0 (no OFT address configured)`)
		}

		const publicClient = this.chainClientManager.getPublicClient(source)
		const account = privateKeyToAccount(this.privateKey as `0x${string}`)
		const recipient = recipientAddress || account.address

		const amountWei = parseUnits(amount, 6)
		const recipientBytes32 = padHex(recipient, { size: 32 })

		const sendParam = {
			dstEid: destEid,
			to: recipientBytes32,
			amountLD: amountWei,
			minAmountLD: 0n,
			extraOptions: "0x" as HexString,
			composeMsg: "0x" as HexString,
			oftCmd: "0x" as HexString,
		}

		const [oftLimit, , oftReceipt] = await publicClient.readContract({
			address: oftAddress,
			abi: OFT_ABI,
			functionName: "quoteOFT",
			args: [sendParam],
		})

		sendParam.minAmountLD = oftReceipt.amountReceivedLD

		const msgFee = await publicClient.readContract({
			address: oftAddress,
			abi: OFT_ABI,
			functionName: "quoteSend",
			args: [sendParam, false],
		})

		return {
			amountSent: oftReceipt.amountSentLD,
			amountReceived: oftReceipt.amountReceivedLD,
			nativeFee: msgFee.nativeFee,
			minAmount: oftLimit.minAmountLD,
			maxAmount: oftLimit.maxAmountLD,
		}
	}
}
