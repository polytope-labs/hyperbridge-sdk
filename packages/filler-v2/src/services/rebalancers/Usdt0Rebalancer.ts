import { parseUnits, padHex, maxUint256, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bytes20ToBytes32, type HexString, parseStateMachineId } from "@hyperbridge/sdk"
import { ChainClientManager } from "../ChainClientManager"
import { FillerConfigService } from "../FillerConfigService"
import { getLogger, type Logger } from "../Logger"
import { OFT_ABI } from "@/config/abis/Oft"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { RebalanceOptions } from "."

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
 * Usdt0Rebalancer - Cross-chain USDT0 transfers using LayerZero OFT
 */
export class Usdt0Rebalancer {
	private readonly chainClientManager: ChainClientManager
	private readonly configService: FillerConfigService
	private readonly privateKey: HexString
	private readonly logger: Logger

	constructor(chainClientManager: ChainClientManager, configService: FillerConfigService, privateKey: HexString) {
		this.chainClientManager = chainClientManager
		this.configService = configService
		this.privateKey = privateKey
		this.logger = getLogger("Usdt0Rebalancer")
	}

	/**
	 * Sends USDT0 cross-chain using LayerZero OFT
	 */
	async sendUsdt0(options: RebalanceOptions) {
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
		const recipientBytes32 = bytes20ToBytes32(recipient)
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
