import { encodeFunctionData, decodeFunctionData, concat, formatUnits, keccak256, parseEventLogs } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { ABI as IntentGatewayV2ABI } from "@/abis/IntentGatewayV2"
import { ADDRESS_ZERO, bytes32ToBytes20, hexToString, retryPromise } from "@/utils"
import type {
	OrderV2,
	HexString,
	PackedUserOperation,
	SubmitBidOptions,
	FillOptionsV2,
	SelectOptions,
	FillerBid,
	SelectBidResult,
} from "@/types"
import type { IntentsV2Context } from "./types"
import { BundlerMethod } from "./types"
import { transformOrderForContract } from "./utils"
import { CryptoUtils } from "./CryptoUtils"
import Decimal from "decimal.js"

export class BidManager {
	private readonly crypto: CryptoUtils

	constructor(private readonly ctx: IntentsV2Context) {
		this.crypto = new CryptoUtils(ctx)
	}

	async prepareSubmitBid(options: SubmitBidOptions): Promise<PackedUserOperation> {
		const {
			order,
			fillOptions,
			solverAccount,
			solverPrivateKey,
			nonce,
			entryPointAddress,
			callGasLimit,
			verificationGasLimit,
			preVerificationGas,
			maxFeePerGas,
			maxPriorityFeePerGas,
		} = options

		const chainId = BigInt(
			this.ctx.dest.client.chain?.id ?? Number.parseInt(this.ctx.dest.config.stateMachineId.split("-")[1]),
		)

		let callData: HexString
		if (options.callData) {
			callData = options.callData
		} else {
			const fillOrderCalldata = encodeFunctionData({
				abi: IntentGatewayV2ABI,
				functionName: "fillOrder",
				args: [transformOrderForContract(order), fillOptions],
			}) as HexString

			const nativeOutputValue = order.output.assets
				.filter((asset) => bytes32ToBytes20(asset.token) === ADDRESS_ZERO)
				.reduce((sum, asset) => sum + asset.amount, 0n)
			const totalNativeValue = nativeOutputValue + fillOptions.nativeDispatchFee

			const intentGatewayV2Address = this.ctx.dest.configService.getIntentGatewayV2Address(order.destination)

			callData = this.crypto.encodeERC7821Execute([
				{
					target: intentGatewayV2Address,
					value: totalNativeValue,
					data: fillOrderCalldata,
				},
			])
		}

		const accountGasLimits = this.crypto.packGasLimits(verificationGasLimit, callGasLimit)
		const gasFees = this.crypto.packGasFees(maxPriorityFeePerGas, maxFeePerGas)

		const userOp: PackedUserOperation = {
			sender: solverAccount,
			nonce,
			initCode: "0x" as HexString,
			callData,
			accountGasLimits,
			preVerificationGas,
			gasFees,
			paymasterAndData: "0x" as HexString,
			signature: "0x" as HexString,
		}

		const userOpHash = this.crypto.computeUserOpHash(userOp, entryPointAddress, chainId)
		const sessionKey = order.session

		const messageHash = keccak256(concat([userOpHash, order.id as HexString, sessionKey as import("viem").Hex]))

		const solverAccount_ = privateKeyToAccount(solverPrivateKey as import("viem").Hex)
		const solverSignature = await solverAccount_.signMessage({ message: { raw: messageHash } })

		const signature = concat([order.id as HexString, solverSignature as import("viem").Hex]) as HexString

		return { ...userOp, signature }
	}

	async selectBid(order: OrderV2, bids: FillerBid[], sessionPrivateKey?: HexString): Promise<SelectBidResult> {
		const commitment = order.id as HexString
		const sessionKeyData = sessionPrivateKey
			? { privateKey: sessionPrivateKey as HexString }
			: await this.ctx.sessionKeyStorage.getSessionKey(commitment)
		if (!sessionKeyData) {
			throw new Error("SessionKey not found for commitment: " + commitment)
		}

		if (!this.ctx.bundlerUrl) {
			throw new Error("Bundler URL not configured")
		}

		if (!this.ctx.intentsCoprocessor) {
			throw new Error("IntentsCoprocessor required")
		}

		const sortedBids = await this.validateAndSortBids(bids, order)
		if (sortedBids.length === 0) {
			throw new Error("No valid bids found")
		}

		const intentGatewayV2Address = this.ctx.dest.configService.getIntentGatewayV2Address(
			hexToString(order.destination as HexString),
		)

		const domainSeparator = this.crypto.getDomainSeparator(
			"IntentGateway",
			"2",
			BigInt(
				this.ctx.dest.client.chain?.id ?? Number.parseInt(this.ctx.dest.config.stateMachineId.split("-")[1]),
			),
			intentGatewayV2Address,
		)

		let selectedBid: { bid: FillerBid; options: FillOptionsV2 } | null = null
		let sessionSignature: HexString | null = null

		for (const bidWithOptions of sortedBids) {
			const solverAddress = bidWithOptions.bid.userOp.sender

			const signature = await this.crypto.signSolverSelection(
				commitment,
				solverAddress,
				domainSeparator,
				sessionKeyData.privateKey,
			)
			if (!signature) {
				continue
			}

			const selectOptions: SelectOptions = {
				commitment,
				solver: solverAddress,
				signature,
			}

			try {
				await this.simulateAndValidate(
					order,
					selectOptions,
					bidWithOptions.options,
					solverAddress,
					intentGatewayV2Address,
				)
				selectedBid = bidWithOptions
				sessionSignature = signature
				break
			} catch {
				continue
			}
		}

		if (!selectedBid || !sessionSignature) {
			throw new Error("No bids passed simulation")
		}

		const solverAddress = selectedBid.bid.userOp.sender

		const finalSignature = concat([
			selectedBid.bid.userOp.signature as import("viem").Hex,
			sessionSignature as import("viem").Hex,
		]) as HexString

		const signedUserOp: PackedUserOperation = {
			...selectedBid.bid.userOp,
			signature: finalSignature,
		}

		const entryPointAddress = this.ctx.dest.configService.getEntryPointV08Address(
			hexToString(order.destination as HexString),
		)
		const chainId = BigInt(
			this.ctx.dest.client.chain?.id ?? Number.parseInt(this.ctx.dest.config.stateMachineId.split("-")[1]),
		)
		const userOpHash = this.crypto.computeUserOpHash(signedUserOp, entryPointAddress, chainId)

		const bundlerResult = await this.crypto.sendBundler<HexString>(BundlerMethod.ETH_SEND_USER_OPERATION, [
			this.crypto.prepareBundlerCall(signedUserOp),
			entryPointAddress,
		])

		const finalUserOpHash = bundlerResult || userOpHash

		let txnHash: HexString | undefined
		let fillStatus: "full" | "partial" | undefined
		try {
			const receipt = await retryPromise(
				async () => {
					const result = await this.crypto.sendBundler<{
						receipt: { transactionHash: HexString }
					} | null>(BundlerMethod.ETH_GET_USER_OPERATION_RECEIPT, [finalUserOpHash])
					if (!result?.receipt?.transactionHash) {
						throw new Error("Receipt not available yet")
					}
					return result
				},
				{ maxRetries: 5, backoffMs: 2000, logMessage: "Fetching user operation receipt" },
			)
			txnHash = receipt.receipt.transactionHash

			if (order.source === order.destination) {
				try {
					const chainReceipt = await this.ctx.dest.client.getTransactionReceipt({
						hash: txnHash,
					})
					const events = parseEventLogs({
						abi: IntentGatewayV2ABI,
						logs: chainReceipt.logs,
						eventName: ["OrderFilled", "PartialFill"] as any,
					})

					const matched = events.find((e) => {
						const eventCommitment = (e.args as any).commitment as HexString
						return eventCommitment.toLowerCase() === commitment.toLowerCase()
					})

					if (matched?.eventName === "OrderFilled") {
						fillStatus = "full"
					} else if (matched?.eventName === "PartialFill") {
						fillStatus = "partial"
					}
				} catch {
					throw new Error("Failed to determine fill status from logs")
				}
			}
		} catch {
			// Receipt may not be available
		}

		return {
			userOp: signedUserOp,
			userOpHash: finalUserOpHash,
			solverAddress,
			commitment,
			txnHash,
			fillStatus,
		}
	}

	private async validateAndSortBids(
		bids: FillerBid[],
		order: OrderV2,
	): Promise<{ bid: FillerBid; options: FillOptionsV2; usdValue: Decimal }[]> {
		const validBids: { bid: FillerBid; options: FillOptionsV2; usdValue: Decimal }[] = []

		const destChain = hexToString(order.destination as HexString)
		const isSameChain = order.source === order.destination

		const wethAddress = this.ctx.dest.configService.getWrappedNativeAssetWithDecimals(destChain).asset.toLowerCase()
		const usdcAddress = this.ctx.dest.configService.getUsdcAsset(destChain).toLowerCase()
		const usdtAddress = this.ctx.dest.configService.getUsdtAsset(destChain).toLowerCase()
		const usdcDecimals = this.ctx.dest.configService.getUsdcDecimals(destChain)
		const usdtDecimals = this.ctx.dest.configService.getUsdtDecimals(destChain)

		let wethPriceUsd = new Decimal(0)
		try {
			const oneWeth = 10n ** 18n
			const { amountOut } = await this.ctx.swap.findBestProtocolWithAmountIn(
				this.ctx.dest.client,
				wethAddress as HexString,
				usdcAddress as HexString,
				oneWeth,
				destChain,
				{ selectedProtocol: "v2" },
			)
			wethPriceUsd = new Decimal(formatUnits(amountOut, usdcDecimals))
		} catch {
			throw new Error("Failed to fetch WETH price")
		}

		for (const bid of bids) {
			try {
				const innerCalls = this.crypto.decodeERC7821Execute(bid.userOp.callData)
				if (!innerCalls || innerCalls.length === 0) {
					continue
				}

				let fillOptions: FillOptionsV2 | null = null
				for (const call of innerCalls) {
					try {
						const decoded = decodeFunctionData({
							abi: IntentGatewayV2ABI,
							data: call.data,
						})

						if (decoded?.functionName === "fillOrder" && decoded.args && decoded.args.length >= 2) {
							fillOptions = decoded.args[1] as FillOptionsV2
							break
						}
					} catch {
						continue
					}
				}

				if (!fillOptions || !fillOptions.outputs) {
					continue
				}

				const bidOutputs = fillOptions.outputs
				let isValid = true
				for (let i = 0; i < order.output.assets.length; i++) {
					const requiredAsset = order.output.assets[i]
					const bidOutput = bidOutputs[i]

					if (!bidOutput) {
						isValid = false
						break
					}

					const bidAmount = bidOutput.amount

					if (isSameChain) {
						if (bidAmount <= 0n) {
							isValid = false
							break
						}
					} else {
						if (bidAmount < requiredAsset.amount) {
							isValid = false
							break
						}
					}
				}

				if (!isValid) continue

				let totalUsdValue = new Decimal(0)
				for (let i = 0; i < bidOutputs.length; i++) {
					const tokenAddress = bytes32ToBytes20(order.output.assets[i].token).toLowerCase()
					const amount = bidOutputs[i].amount

					if (tokenAddress === usdcAddress) {
						totalUsdValue = totalUsdValue.plus(new Decimal(formatUnits(amount, usdcDecimals)))
					} else if (tokenAddress === usdtAddress) {
						totalUsdValue = totalUsdValue.plus(new Decimal(formatUnits(amount, usdtDecimals)))
					} else if (tokenAddress === wethAddress) {
						const wethAmount = new Decimal(formatUnits(amount, 18))
						totalUsdValue = totalUsdValue.plus(wethAmount.times(wethPriceUsd))
					}
				}

				validBids.push({ bid, options: fillOptions, usdValue: totalUsdValue })
			} catch {
				continue
			}
		}

		validBids.sort((a, b) => b.usdValue.minus(a.usdValue).toNumber())
		return validBids
	}

	private async simulateAndValidate(
		order: OrderV2,
		selectOptions: SelectOptions,
		fillOptions: FillOptionsV2,
		solverAddress: HexString,
		intentGatewayV2Address: HexString,
	): Promise<void> {
		const nativeOutputValue = order.output.assets
			.filter((asset) => bytes32ToBytes20(asset.token) === ADDRESS_ZERO)
			.reduce((sum, asset) => sum + asset.amount, 0n)
		const totalNativeValue = nativeOutputValue + fillOptions.nativeDispatchFee

		const selectCalldata = encodeFunctionData({
			abi: IntentGatewayV2ABI,
			functionName: "select",
			args: [selectOptions],
		}) as HexString

		const fillOrderCalldata = encodeFunctionData({
			abi: IntentGatewayV2ABI,
			functionName: "fillOrder",
			args: [transformOrderForContract(order), fillOptions],
		}) as HexString

		const batchedCalldata = this.crypto.encodeERC7821Execute([
			{
				target: intentGatewayV2Address,
				value: 0n,
				data: selectCalldata,
			},
			{
				target: intentGatewayV2Address,
				value: totalNativeValue,
				data: fillOrderCalldata,
			},
		])

		try {
			await this.ctx.dest.client.call({
				account: solverAddress,
				to: solverAddress,
				data: batchedCalldata,
				value: totalNativeValue,
			})
		} catch (e: unknown) {
			throw new Error(`Simulation failed: ${e instanceof Error ? e.message : String(e)}`)
		}
	}
}
