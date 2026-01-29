import {
	encodeFunctionData,
	decodeFunctionData,
	keccak256,
	toHex,
	encodeAbiParameters,
	decodeAbiParameters,
	concat,
	pad,
	maxUint256,
	type Hex,
	formatUnits,
	parseUnits,
	parseAbiParameters,
	encodePacked,
	WalletClient,
	parseEventLogs,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { ABI as IntentGatewayV2ABI } from "@/abis/IntentGatewayV2"
import { createSessionKeyStorage, type SessionKeyData } from "@/storage"
import {
	type HexString,
	type OrderV2,
	type PackedUserOperation,
	type SubmitBidOptions,
	type EstimateFillOrderV2Params,
	type FillOrderEstimateV2,
	type IPostRequest,
	type DispatchPost,
	type FillOptionsV2,
	type SelectOptions,
	type FillerBid,
	type IntentOrderStatusUpdate,
	type SelectBidResult,
	type ExecuteIntentOrderOptions,
	type DecodedOrderV2PlacedLog,
} from "@/types"
import {
	ADDRESS_ZERO,
	bytes32ToBytes20,
	bytes20ToBytes32,
	ERC20Method,
	retryPromise,
	fetchPrice,
	adjustDecimals,
	constructRedeemEscrowRequestBody,
	MOCK_ADDRESS,
	getRecordedStorageSlot,
	sleep,
	DEFAULT_POLL_INTERVAL,
	hexToString,
} from "@/utils"
import { orderV2Commitment } from "@/utils"
import { Swap } from "@/utils/swap"
import { EvmChain } from "@/chains/evm"
import { IntentsCoprocessor } from "@/chains/intentsCoprocessor"
import Decimal from "decimal.js"
import IntentGateway from "@/abis/IntentGateway"
import ERC7821ABI from "@/abis/erc7281"
import { type ERC7821Call } from "@/types"

/** EIP-712 type hash for SelectSolver message */
export const SELECT_SOLVER_TYPEHASH = keccak256(toHex("SelectSolver(bytes32 commitment,address solver)"))

/** EIP-712 type hash for PackedUserOperation */
export const PACKED_USEROP_TYPEHASH = keccak256(
	toHex(
		"PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)",
	),
)

/** EIP-712 type hash for EIP712Domain */
export const DOMAIN_TYPEHASH = keccak256(
	toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
)

/** Default graffiti value (bytes32 zero) */
export const DEFAULT_GRAFFITI = "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString

/**
 * ERC-7821 single batch execution mode.
 */
export const ERC7821_BATCH_MODE = "0x0100000000000000000000000000000000000000000000000000000000000000" as HexString

/**
 * IntentGatewayV2 utilities for placing orders and submitting bids.
 * Automatically manages session keys for solver selection.
 */
export class IntentGatewayV2 {
	private readonly storage: ReturnType<typeof createSessionKeyStorage>
	private readonly swap: Swap = new Swap()
	private readonly feeTokenCache: Map<string, { address: HexString; decimals: number }> = new Map()
	private readonly domainSeparatorCache: Map<HexString, HexString> = new Map()
	private initPromise: Promise<void> | null = null

	constructor(
		public readonly source: EvmChain,
		public readonly dest: EvmChain,
		public readonly intentsCoprocessor?: IntentsCoprocessor,
		public readonly bundlerUrl?: string,
	) {
		this.storage = createSessionKeyStorage()
		this.initPromise = this.initFeeTokenCache()
	}

	/**
	 * Ensures the fee token cache is initialized before use.
	 * This is called automatically by methods that need the cache.
	 */
	async ensureInitialized(): Promise<void> {
		if (this.initPromise) {
			await this.initPromise
		}
	}

	private async initFeeTokenCache(): Promise<void> {
		const sourceFeeToken = await this.source.getFeeTokenWithDecimals()
		this.feeTokenCache.set(this.source.config.stateMachineId, sourceFeeToken)
		const destFeeToken = await this.dest.getFeeTokenWithDecimals()
		this.feeTokenCache.set(this.dest.config.stateMachineId, destFeeToken)
	}

	/**
	 * Gets the domain separator for an IntentGatewayV2 contract, with caching.
	 * @param gatewayAddress - The address of the IntentGatewayV2 contract
	 * @returns The domain separator
	 */
	async getDomainSeparator(gatewayAddress: HexString): Promise<HexString> {
		const cached = this.domainSeparatorCache.get(gatewayAddress)
		if (cached) {
			return cached
		}

		const domainSeparator = (await this.dest.client.readContract({
			address: gatewayAddress,
			abi: IntentGatewayV2ABI,
			functionName: "DOMAIN_SEPARATOR",
		})) as HexString

		this.domainSeparatorCache.set(gatewayAddress, domainSeparator)
		return domainSeparator
	}

	// =========================================================================
	// Main Entry Points
	// =========================================================================

	/** Places an order on the source chain and returns the transaction hash and the final order */
	async placeOrder(
		order: OrderV2,
		graffiti: HexString = DEFAULT_GRAFFITI,
		walletClient: WalletClient,
	): Promise<{ txHash: HexString; order: OrderV2; sessionPrivateKey: HexString }> {
		const privateKey = generatePrivateKey()
		const account = privateKeyToAccount(privateKey)
		const sessionKeyAddress = account.address as HexString

		order.session = sessionKeyAddress

		const hash = await walletClient.writeContract({
			abi: IntentGatewayV2ABI,
			address: this.source.configService.getIntentGatewayV2Address(hexToString(order.destination)),
			functionName: "placeOrder",
			args: [this.transformOrderForContract(order), graffiti],
			account: walletClient.account!,
			chain: walletClient.chain,
		})

		const receipt = await this.source.client.waitForTransactionReceipt({ hash, confirmations: 1 })

		const orderPlacedEvent = parseEventLogs({
			abi: IntentGatewayV2ABI,
			logs: receipt.logs,
			eventName: "OrderPlaced",
		})[0] as unknown as DecodedOrderV2PlacedLog | undefined

		if (!orderPlacedEvent) {
			throw new Error("OrderPlaced event not found in transaction logs")
		}

		order.nonce = orderPlacedEvent.args.nonce
		order.inputs = orderPlacedEvent.args.inputs
		order.output.assets = orderPlacedEvent.args.outputs.map((output) => ({
			token: output.token,
			amount: output.amount,
		}))
		order.id = orderV2Commitment(order)

		const sessionKeyData: SessionKeyData = {
			privateKey: privateKey as HexString,
			address: sessionKeyAddress,
			commitment: order.id as HexString,
			createdAt: Date.now(),
		}

		await this.storage.setSessionKey(order.id as HexString, sessionKeyData)

		return { txHash: hash, order: order, sessionPrivateKey: privateKey as HexString }
	}

	/**
	 * Prepares a bid UserOperation for submitting to Hyperbridge (used by fillers/solvers).
	 *
	 * The callData is encoded using ERC-7821 batch executor format since SolverAccount
	 * extends ERC7821. The format is: execute(bytes32 mode, bytes executionData)
	 * where executionData contains the fillOrder call to IntentGatewayV2.
	 *
	 * @param options - Bid submission options including order, fillOptions, and gas parameters
	 * @returns PackedUserOperation ready for submission to Hyperbridge
	 */
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
			this.dest.client.chain?.id ?? Number.parseInt(this.dest.config.stateMachineId.split("-")[1]),
		)

		// Encode the inner fillOrder call to IntentGatewayV2
		const fillOrderCalldata = encodeFunctionData({
			abi: IntentGatewayV2ABI,
			functionName: "fillOrder",
			args: [this.transformOrderForContract(order), fillOptions],
		}) as HexString

		// Calculate the native value needed for fillOrder (native outputs + dispatch fee)
		const nativeOutputValue = order.output.assets
			.filter((asset) => bytes32ToBytes20(asset.token) === ADDRESS_ZERO)
			.reduce((sum, asset) => sum + asset.amount, 0n)
		const totalNativeValue = nativeOutputValue + fillOptions.nativeDispatchFee

		const intentGatewayV2Address = this.dest.configService.getIntentGatewayV2Address(order.destination)

		const callData = this.encodeERC7821Execute([
			{
				target: intentGatewayV2Address,
				value: totalNativeValue,
				data: fillOrderCalldata,
			},
		])

		const accountGasLimits = this.packGasLimits(verificationGasLimit, callGasLimit)
		const gasFees = this.packGasFees(maxPriorityFeePerGas, maxFeePerGas)

		const userOp: PackedUserOperation = {
			sender: solverAccount,
			nonce,
			initCode: "0x" as HexString,
			callData,
			accountGasLimits,
			preVerificationGas,
			gasFees,
			paymasterAndData: "0x" as HexString,
			signature: "0x" as HexString, // Will be signed later
		}

		const userOpHash = this.computeUserOpHash(userOp, entryPointAddress, chainId)
		const sessionKey = order.session

		// Sign: keccak256(abi.encodePacked(userOpHash, commitment, sessionKey))
		// sessionKey is address (20 bytes), not padded to 32
		const messageHash = keccak256(concat([userOpHash, order.id as HexString, sessionKey as Hex]))

		const solverAccount_ = privateKeyToAccount(solverPrivateKey as Hex)
		const solverSignature = await solverAccount_.signMessage({ message: { raw: messageHash } })

		// Signature: commitment (32 bytes) + solverSignature (65 bytes)
		const signature = concat([order.id as HexString, solverSignature as Hex]) as HexString

		return { ...userOp, signature }
	}

	/**
	 * Selects the best bid from Hyperbridge and submits to the bundler.
	 *
	 * 1. Fetches bids from Hyperbridge
	 * 2. Validates and sorts bids by USD value (WETH price fetched via swap, USDC/USDT at $1)
	 * 3. Tries each bid (best to worst) until one passes simulation
	 * 4. Signs and submits the winning bid to the bundler
	 *
	 * Requires `bundlerUrl` and `intentsCoprocessor` to be set in the constructor.
	 */
	async selectBid(order: OrderV2, bids: FillerBid[], sessionPrivateKey?: HexString): Promise<SelectBidResult> {
		const commitment = order.id as HexString
		const sessionKeyData = sessionPrivateKey
			? { privateKey: sessionPrivateKey as HexString }
			: await this.storage.getSessionKey(commitment)
		if (!sessionKeyData) {
			throw new Error("SessionKey not found for commitment: " + commitment)
		}

		if (!this.bundlerUrl) {
			throw new Error("Bundler URL not configured")
		}

		if (!this.intentsCoprocessor) {
			throw new Error("IntentsCoprocessor required")
		}

		// Validate and sort bids by USD value (best to worst)
		const sortedBids = await this.validateAndSortBids(bids, order)
		if (sortedBids.length === 0) {
			throw new Error("No valid bids found")
		}

		const intentGatewayV2Address = this.dest.configService.getIntentGatewayV2Address(hexToString(order.destination))

		const domainSeparator = await this.getDomainSeparator(intentGatewayV2Address)

		// Try each bid in order (best to worst) until one passes simulation
		let selectedBid: { bid: FillerBid; options: FillOptionsV2 } | null = null
		let sessionSignature: HexString | null = null

		for (const bidWithOptions of sortedBids) {
			const solverAddress = bidWithOptions.bid.userOp.sender

			// Sign for this solver (must re-sign for each different solver)
			const signature = await this.signSolverSelection(
				commitment,
				solverAddress,
				domainSeparator,
				sessionKeyData.privateKey,
			)
			if (!signature) {
				console.log("Signature is null")
				continue
			}

			const selectOptions: SelectOptions = {
				commitment,
				solver: solverAddress,
				signature,
			}

			// Try simulation
			try {
				await this.simulateAndValidate(
					order,
					selectOptions,
					bidWithOptions.options,
					solverAddress,
					intentGatewayV2Address,
				)
				// Simulation succeeded, use this bid
				selectedBid = bidWithOptions
				sessionSignature = signature
				break
			} catch {
				// Simulation failed, try next bid
				continue
			}
		}

		if (!selectedBid || !sessionSignature) {
			throw new Error("No bids passed simulation")
		}

		const solverAddress = selectedBid.bid.userOp.sender

		const finalSignature = concat([selectedBid.bid.userOp.signature as Hex, sessionSignature as Hex]) as HexString

		const signedUserOp: PackedUserOperation = {
			...selectedBid.bid.userOp,
			signature: finalSignature,
		}

		const entryPointAddress = this.dest.configService.getEntryPointV08Address(hexToString(order.destination))
		const chainId = BigInt(
			this.dest.client.chain?.id ?? Number.parseInt(this.dest.config.stateMachineId.split("-")[1]),
		)
		const userOpHash = this.computeUserOpHash(signedUserOp, entryPointAddress, chainId)

		const bundlerResponse = await fetch(this.bundlerUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "eth_sendUserOperation",
				params: [this.prepareBundlerCall(signedUserOp), entryPointAddress],
			}),
		})

		const bundlerResult = await bundlerResponse.json()

		if (bundlerResult.error) {
			throw new Error(`Bundler error: ${bundlerResult.error.message || JSON.stringify(bundlerResult.error)}`)
		}

		return {
			userOp: signedUserOp,
			userOpHash: (bundlerResult.result || userOpHash) as HexString,
			solverAddress,
			commitment,
		}
	}

	/**
	 * Generator function that orchestrates the full intent order execution flow.
	 *
	 * Flow: ORDER_SUBMITTED → ORDER_CONFIRMED → AWAITING_BIDS → BIDS_RECEIVED → BID_SELECTED → USEROP_SUBMITTED
	 *
	 * Requires `intentsCoprocessor` and `bundlerUrl` to be set in the constructor.
	 *
	 * Session keys are automatically managed internally with environment-appropriate storage
	 * (Node.js filesystem, browser localStorage/IndexedDB, or in-memory fallback).
	 *
	 * @example
	 * ```typescript
	 * const gateway = new IntentGatewayV2(source, dest, coprocessor, bundlerUrl)
	 *
	 * // 1. Prepare order calldata (generates and stores session key internally)
	 * const calldata = await gateway.preparePlaceOrder(order)
	 *
	 * // 2. Submit the transaction
	 * const txHash = await walletClient.sendTransaction({
	 *   to: source.configService.getIntentGatewayV2Address(order.source),
	 *   data: calldata,
	 * })
	 *
	 * // 3. Track execution (session key is retrieved automatically for bid selection)
	 * for await (const status of gateway.executeIntentOrder({ order, orderTxHash: txHash })) {
	 *   console.log(status.status, status.metadata)
	 * }
	 * ```
	 */
	async *executeIntentOrder(options: ExecuteIntentOrderOptions): AsyncGenerator<IntentOrderStatusUpdate, void> {
		const {
			order,
			sessionPrivateKey,
			minBids = 1,
			bidTimeoutMs = 60_000,
			pollIntervalMs = DEFAULT_POLL_INTERVAL,
		} = options

		const commitment = order.id as HexString

		if (!this.intentsCoprocessor) {
			yield {
				status: "FAILED",
				metadata: { error: "IntentsCoprocessor required for order execution" },
			}
			return
		}

		if (!this.bundlerUrl) {
			yield {
				status: "FAILED",
				metadata: { error: "Bundler URL not configured" },
			}
			return
		}

		try {
			yield {
				status: "AWAITING_BIDS",
				metadata: { commitment },
			}

			const startTime = Date.now()
			let bids: FillerBid[] = []

			while (Date.now() - startTime < bidTimeoutMs) {
				try {
					bids = await this.intentsCoprocessor.getBidsForOrder(commitment)

					if (bids.length >= minBids) {
						break
					}
				} catch {
					// Continue polling on errors
				}

				await sleep(pollIntervalMs)
			}

			if (bids.length === 0) {
				yield {
					status: "FAILED",
					metadata: {
						commitment,
						error: `No bids received within ${bidTimeoutMs}ms timeout`,
					},
				}
				return
			}

			yield {
				status: "BIDS_RECEIVED",
				metadata: {
					commitment,
					bidCount: bids.length,
					bids,
				},
			}

			try {
				const result = await this.selectBid(order, bids, sessionPrivateKey)

				yield {
					status: "BID_SELECTED",
					metadata: {
						commitment,
						selectedSolver: result.solverAddress,
						userOpHash: result.userOpHash,
						userOp: result.userOp,
					},
				}

				yield {
					status: "USEROP_SUBMITTED",
					metadata: {
						commitment,
						userOpHash: result.userOpHash,
						selectedSolver: result.solverAddress,
					},
				}
			} catch (err) {
				yield {
					status: "FAILED",
					metadata: {
						commitment,
						error: `Failed to select bid and submit: ${err instanceof Error ? err.message : String(err)}`,
					},
				}
				return
			}
		} catch (err) {
			yield {
				status: "FAILED",
				metadata: {
					commitment,
					error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
				},
			}
		}
	}

	/**
	 * Validates bids and sorts them by USD value (best to worst).
	 * A bid is valid if fillOptions.outputs[i].amount >= order.output.assets[i].amount for all i.
	 * USD value is calculated using USDC/USDT at $1 and WETH price fetched via swap.
	 */
	private async validateAndSortBids(
		bids: FillerBid[],
		order: OrderV2,
	): Promise<{ bid: FillerBid; options: FillOptionsV2; usdValue: Decimal }[]> {
		const validBids: { bid: FillerBid; options: FillOptionsV2; usdValue: Decimal }[] = []

		const destChain = hexToString(order.destination)

		const wethAddress = this.dest.configService.getWrappedNativeAssetWithDecimals(destChain).asset.toLowerCase()
		const usdcAddress = this.dest.configService.getUsdcAsset(destChain).toLowerCase()
		const usdtAddress = this.dest.configService.getUsdtAsset(destChain).toLowerCase()
		const usdcDecimals = this.dest.configService.getUsdcDecimals(destChain)
		const usdtDecimals = this.dest.configService.getUsdtDecimals(destChain)

		let wethPriceUsd = new Decimal(0)
		try {
			const oneWeth = 10n ** 18n
			const { amountOut } = await this.swap.findBestProtocolWithAmountIn(
				this.dest.client,
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
				const innerCalls = this.decodeERC7821Execute(bid.userOp.callData)
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

				if (!fillOptions) {
					throw new Error("Could not find fillOptions in calldata")
				}

				const bidOutputs = fillOptions.outputs
				if (!bidOutputs) {
					continue
				}

				let isValid = true
				for (let i = 0; i < order.output.assets.length; i++) {
					const requiredAmount = order.output.assets[i].amount
					const bidAmount = bidOutputs[i]?.amount ?? 0n

					if (bidAmount < requiredAmount) {
						isValid = false
						break
					}
				}

				if (!isValid) {
					continue
				}

				// Calculate USD value of bid outputs
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

		// Sort by USD value (highest first)
		validBids.sort((a, b) => b.usdValue.minus(a.usdValue).toNumber())

		return validBids
	}

	/**
	 * Simulates select + fillOrder to verify the execution will succeed.
	 * No state overrides are used - the solver should already have tokens and approvals.
	 * The contract validates that outputs >= order.output.assets, so we just need to check execution succeeds.
	 */
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
			args: [this.transformOrderForContract(order), fillOptions],
		}) as HexString

		// Batch calls through ERC7821 execute to ensure transient storage persists
		// This simulates exactly what happens on-chain: SolverAccount.execute([select, fillOrder])
		const batchedCalldata = this.encodeERC7821Execute([
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
			await this.dest.client.call({
				account: solverAddress,
				to: solverAddress, // SolverAccount (the delegated EOA)
				data: batchedCalldata,
				value: totalNativeValue,
			})
		} catch (e: unknown) {
			throw new Error(`Simulation failed: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	/** Estimates gas costs for fillOrder execution via ERC-4337 */
	async estimateFillOrderV2(params: EstimateFillOrderV2Params): Promise<FillOrderEstimateV2> {
		await this.ensureInitialized()

		const { order, solverAccountAddress } = params

		const totalEthValue = order.output.assets
			.filter((output) => bytes32ToBytes20(output.token) === ADDRESS_ZERO)
			.reduce((sum, output) => sum + output.amount, 0n)

		const testValue = toHex(maxUint256 / 2n)
		const intentGatewayV2Address = this.dest.configService.getIntentGatewayV2Address(order.destination)
		const sourceFeeToken = this.feeTokenCache.get(this.source.config.stateMachineId)!
		const destFeeToken = this.feeTokenCache.get(this.dest.config.stateMachineId)!

		// Build assets array for state overrides, including fee token if not already present
		const assetsForOverrides = [...order.output.assets]
		const feeTokenAsBytes32 = bytes20ToBytes32(destFeeToken.address)
		const feeTokenAlreadyInOutputs = assetsForOverrides.some(
			(asset) => asset.token.toLowerCase() === feeTokenAsBytes32.toLowerCase(),
		)
		if (!feeTokenAlreadyInOutputs) {
			assetsForOverrides.push({ token: feeTokenAsBytes32, amount: 0n })
		}

		const stateOverrides = this.buildTokenStateOverrides(
			this.dest.config.stateMachineId,
			assetsForOverrides,
			solverAccountAddress,
			this.dest.configService.getIntentGatewayV2Address(order.destination),
			testValue,
			intentGatewayV2Address,
		)

		// Add native balance override for the solver account
		stateOverrides.push({
			address: solverAccountAddress,
			balance: maxUint256,
		})

		// Estimate fillOrder gas (callGasLimit)
		let callGasLimit: bigint
		const postRequestGas = 400_000n
		const postRequestFeeInSourceFeeToken = await this.convertGasToFeeToken(
			postRequestGas as bigint,
			"source",
			params.order.source,
		)
		let postRequestFeeInDestFeeToken = adjustDecimals(
			postRequestFeeInSourceFeeToken,
			sourceFeeToken.decimals,
			destFeeToken.decimals,
		)

		const postRequest: IPostRequest = {
			source: params.order.destination,
			dest: params.order.source,
			body: constructRedeemEscrowRequestBody(
				{ ...params.order, id: orderV2Commitment(params.order) },
				MOCK_ADDRESS,
			),
			timeoutTimestamp: 0n,
			nonce: await this.source.getHostNonce(),
			from: this.source.configService.getIntentGatewayV2Address(params.order.destination),
			to: this.source.configService.getIntentGatewayV2Address(params.order.source),
		}

		let protocolFeeInNativeToken = await this.quoteNative(postRequest, postRequestFeeInDestFeeToken).catch(() =>
			this.dest.quoteNative(postRequest, postRequestFeeInDestFeeToken).catch(() => 0n),
		)

		// Buffer 0.5%
		protocolFeeInNativeToken = (protocolFeeInNativeToken * 1005n) / 1000n
		postRequestFeeInDestFeeToken = postRequestFeeInDestFeeToken + (postRequestFeeInDestFeeToken * 1005n) / 1000n

		if (!params.fillOptions) {
			params.fillOptions = {
				relayerFee: postRequestFeeInDestFeeToken,
				nativeDispatchFee: protocolFeeInNativeToken,
				outputs: order.output.assets,
			}
		}

		try {
			callGasLimit = await this.dest.client.estimateContractGas({
				abi: IntentGatewayV2ABI,
				address: this.dest.configService.getIntentGatewayV2Address(order.destination),
				functionName: "fillOrder",
				args: [this.transformOrderForContract(order), params.fillOptions],
				account: solverAccountAddress,
				value: totalEthValue + protocolFeeInNativeToken,
				stateOverride: stateOverrides as any,
			})
		} catch (e) {
			console.warn("fillOrder gas estimation failed, using fallback:", e)
			callGasLimit = 500_000n
		}

		// Add buffer for execution through SolverAccount (5%)
		callGasLimit = callGasLimit + (callGasLimit * 5n) / 100n

		// Estimate verificationGasLimit for SolverAccount.validateUserOp
		// EIP-7702 delegated accounts have additional overhead for authorization verification
		const verificationGasLimit = 200_000n

		// Pre-verification gas (bundler overhead for calldata, etc.)
		const preVerificationGas = 100_000n

		// Pimlico requires at least 40 gwei maxPriorityFeePerGas,
		// can use pimlico_getUserOperationGasPrice in future

		const MIN_PRIORITY_FEE = 40_000_000_000n // 40 gwei
		const gasPrice = await this.dest.client.getGasPrice()
		const calculatedPriorityFee = gasPrice / 10n
		const maxPriorityFeePerGas = calculatedPriorityFee > MIN_PRIORITY_FEE ? calculatedPriorityFee : MIN_PRIORITY_FEE

		const calculatedMaxFee = gasPrice + (gasPrice * 20n) / 100n
		const maxFeePerGas =
			calculatedMaxFee > maxPriorityFeePerGas ? calculatedMaxFee : maxPriorityFeePerGas + gasPrice

		// Calculate total gas cost in wei
		const totalGas = callGasLimit + verificationGasLimit + preVerificationGas
		const totalGasCostWei = totalGas * maxFeePerGas

		const totalGasInFeeToken = await this.convertGasToFeeToken(totalGasCostWei, "dest", order.destination)

		return {
			callGasLimit,
			verificationGasLimit,
			preVerificationGas,
			maxFeePerGas,
			maxPriorityFeePerGas,
			totalGasCostWei,
			totalGasInFeeToken,
			fillOptions: params.fillOptions,
		}
	}

	// =========================================================================
	// Signature & Hash Utilities
	// =========================================================================

	/** Signs a solver selection message using the stored session key (EIP-712) */
	async signSolverSelection(
		commitment: HexString,
		solverAddress: HexString,
		domainSeparator: HexString,
		privateKey: HexString,
	): Promise<HexString | null> {
		const account = privateKeyToAccount(privateKey as Hex)

		const structHash = keccak256(
			encodeAbiParameters(
				[{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
				[SELECT_SOLVER_TYPEHASH, commitment, solverAddress],
			),
		)

		const digest = keccak256(concat(["0x1901" as Hex, domainSeparator as Hex, structHash]))
		const signature = await account.sign({ hash: digest })

		return signature as HexString
	}

	computeUserOpHash(userOp: PackedUserOperation, entryPoint: Hex, chainId: bigint): Hex {
		const structHash = keccak256(
			encodeAbiParameters(
				parseAbiParameters("bytes32, address, uint256, bytes32, bytes32, bytes32, uint256, bytes32, bytes32"),
				[
					PACKED_USEROP_TYPEHASH,
					userOp.sender,
					userOp.nonce,
					keccak256(userOp.initCode),
					keccak256(userOp.callData),
					userOp.accountGasLimits as Hex,
					userOp.preVerificationGas,
					userOp.gasFees as Hex,
					keccak256(userOp.paymasterAndData),
				],
			),
		)

		const domainSeparator = keccak256(
			encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [
				DOMAIN_TYPEHASH,
				keccak256(toHex("ERC4337")),
				keccak256(toHex("1")),
				chainId,
				entryPoint,
			]),
		)

		return keccak256(
			encodePacked(["bytes1", "bytes1", "bytes32", "bytes32"], ["0x19", "0x01", domainSeparator, structHash]),
		)
	}

	// =========================================================================
	// Gas Packing Utilities
	// =========================================================================

	/** Packs verificationGasLimit and callGasLimit into bytes32) */
	packGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): HexString {
		const verificationGasHex = pad(toHex(verificationGasLimit), { size: 16 })
		const callGasHex = pad(toHex(callGasLimit), { size: 16 })
		return concat([verificationGasHex, callGasHex]) as HexString
	}

	/** Packs maxPriorityFeePerGas and maxFeePerGas into bytes32 */
	packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): HexString {
		const priorityFeeHex = pad(toHex(maxPriorityFeePerGas), { size: 16 })
		const maxFeeHex = pad(toHex(maxFeePerGas), { size: 16 })
		return concat([priorityFeeHex, maxFeeHex]) as HexString
	}

	/** Unpacks accountGasLimits (bytes32) into verificationGasLimit and callGasLimit */
	unpackGasLimits(accountGasLimits: HexString): { verificationGasLimit: bigint; callGasLimit: bigint } {
		// accountGasLimits = verificationGasLimit (16 bytes) || callGasLimit (16 bytes)
		const hex = accountGasLimits.slice(2) // remove 0x
		const verificationGasLimit = BigInt(`0x${hex.slice(0, 32)}`)
		const callGasLimit = BigInt(`0x${hex.slice(32, 64)}`)
		return { verificationGasLimit, callGasLimit }
	}

	/** Unpacks gasFees (bytes32) into maxPriorityFeePerGas and maxFeePerGas */
	unpackGasFees(gasFees: HexString): { maxPriorityFeePerGas: bigint; maxFeePerGas: bigint } {
		// gasFees = maxPriorityFeePerGas (16 bytes) || maxFeePerGas (16 bytes)
		const hex = gasFees.slice(2) // remove 0x
		const maxPriorityFeePerGas = BigInt(`0x${hex.slice(0, 32)}`)
		const maxFeePerGas = BigInt(`0x${hex.slice(32, 64)}`)
		return { maxPriorityFeePerGas, maxFeePerGas }
	}

	/**
	 * Converts a PackedUserOperation to bundler-compatible v0.7/v0.8 format.
	 * Unpacks gas limits and fees, extracts factory/paymaster data from packed fields.
	 *
	 * @param userOp - The packed user operation to convert
	 * @returns Bundler-compatible user operation object
	 */
	prepareBundlerCall(userOp: PackedUserOperation): Record<string, unknown> {
		const { verificationGasLimit, callGasLimit } = this.unpackGasLimits(userOp.accountGasLimits)
		const { maxPriorityFeePerGas, maxFeePerGas } = this.unpackGasFees(userOp.gasFees)

		// Convert initCode to factory/factoryData
		const hasFactory = userOp.initCode && userOp.initCode !== "0x" && userOp.initCode.length > 2
		const factory = hasFactory ? (`0x${userOp.initCode.slice(2, 42)}` as HexString) : undefined
		const factoryData = hasFactory ? (`0x${userOp.initCode.slice(42)}` as HexString) : undefined

		const hasPaymaster =
			userOp.paymasterAndData && userOp.paymasterAndData !== "0x" && userOp.paymasterAndData.length > 2
		const paymaster = hasPaymaster ? (`0x${userOp.paymasterAndData.slice(2, 42)}` as HexString) : undefined
		const paymasterData = hasPaymaster ? (`0x${userOp.paymasterAndData.slice(42)}` as HexString) : undefined

		// Build bundler-compatible userOp (only include defined fields)
		const userOpBundler: Record<string, unknown> = {
			sender: userOp.sender,
			nonce: toHex(userOp.nonce),
			callData: userOp.callData,
			callGasLimit: toHex(callGasLimit),
			verificationGasLimit: toHex(verificationGasLimit),
			preVerificationGas: toHex(userOp.preVerificationGas),
			maxFeePerGas: toHex(maxFeePerGas),
			maxPriorityFeePerGas: toHex(maxPriorityFeePerGas),
			signature: userOp.signature,
		}

		// Only add factory fields if present
		if (factory) {
			userOpBundler.factory = factory
			userOpBundler.factoryData = factoryData || "0x"
		}

		// Only add paymaster fields if present
		if (paymaster) {
			userOpBundler.paymaster = paymaster
			userOpBundler.paymasterData = paymasterData || "0x"
			userOpBundler.paymasterVerificationGasLimit = toHex(50_000n)
			userOpBundler.paymasterPostOpGasLimit = toHex(50_000n)
		}

		return userOpBundler
	}

	// =========================================================================
	// ERC-7821 Batch Executor Utilities
	// =========================================================================

	/**
	 * Encodes calls into ERC-7821 execute function calldata.
	 * Format: execute(bytes32 mode, bytes executionData)
	 * Where executionData = abi.encode(calls) and calls = (address target, uint256 value, bytes data)[]
	 *
	 * @param calls - Array of calls to encode
	 * @returns Encoded calldata for execute function
	 */
	encodeERC7821Execute(calls: ERC7821Call[]): HexString {
		const executionData = encodeAbiParameters(
			[{ type: "tuple[]", components: ERC7821ABI.ABI[1].components }],
			[calls.map((call) => ({ target: call.target, value: call.value, data: call.data }))],
		) as HexString

		return encodeFunctionData({
			abi: ERC7821ABI.ABI,
			functionName: "execute",
			args: [ERC7821_BATCH_MODE, executionData],
		}) as HexString
	}

	/**
	 * Decodes ERC-7821 execute function calldata back into individual calls.
	 *
	 * @param callData - The execute function calldata to decode
	 * @returns Array of decoded calls, or null if decoding fails
	 */
	decodeERC7821Execute(callData: HexString): ERC7821Call[] | null {
		try {
			const decoded = decodeFunctionData({
				abi: ERC7821ABI.ABI,
				data: callData,
			})

			if (decoded?.functionName !== "execute" || !decoded.args || decoded.args.length < 2) {
				return null
			}

			const executionData = decoded.args[1] as HexString

			const [calls] = decodeAbiParameters(
				[{ type: "tuple[]", components: ERC7821ABI.ABI[1].components }],
				executionData,
			) as [ERC7821Call[]]

			return calls.map((call) => ({
				target: call.target as HexString,
				value: call.value,
				data: call.data as HexString,
			}))
		} catch {
			return null
		}
	}

	// =========================================================================
	// Session Key Management
	// =========================================================================

	/** Retrieves a stored session key by order commitment */
	async getSessionKey(commitment: HexString): Promise<SessionKeyData | null> {
		return this.storage.getSessionKey(commitment)
	}

	/** Removes a stored session key */
	async removeSessionKey(commitment: HexString): Promise<void> {
		return this.storage.removeSessionKey(commitment)
	}

	/** Lists all stored session keys */
	async listSessionKeys(): Promise<SessionKeyData[]> {
		return this.storage.listSessionKeys()
	}

	// =========================================================================
	// Private Helpers
	// =========================================================================

	/** Builds state overrides for token balances and allowances to enable gas estimation */
	private buildTokenStateOverrides(
		chain: string,
		outputAssets: { token: HexString; amount: bigint }[],
		accountAddress: HexString,
		spenderAddress: HexString,
		testValue: HexString,
		intentGatewayV2Address?: HexString,
	): { address: HexString; balance?: bigint; stateDiff?: { slot: HexString; value: HexString }[] }[] {
		const overrides: { address: HexString; stateDiff: { slot: HexString; value: HexString }[] }[] = []

		// Params struct starts at slot 4, and slot 5 contains dispatcher + solverSelection packed
		// Slot 5 layout (64 hex chars after 0x):
		// - chars 2-23 (22 chars, 11 bytes): padding
		// - chars 24-25 (2 chars, 1 byte): solverSelection
		// - chars 26-65 (40 chars, 20 bytes): dispatcher
		if (intentGatewayV2Address) {
			const paramsSlot5 = pad(toHex(5n), { size: 32 }) as HexString
			const dispatcherAddress = this.dest.configService.getCalldispatcherAddress(chain)
			// Set solverSelection to 0x00, padding is zeros, dispatcher from config
			const newSlot5Value = ("0x" + "0".repeat(22) + "00" + dispatcherAddress.slice(2).toLowerCase()) as HexString
			overrides.push({
				address: intentGatewayV2Address,
				stateDiff: [{ slot: paramsSlot5, value: newSlot5Value }],
			})
		}

		for (const output of outputAssets) {
			const tokenAddress = bytes32ToBytes20(output.token)

			if (tokenAddress === ADDRESS_ZERO) {
				continue
			}

			try {
				const stateDiffs: { slot: HexString; value: HexString }[] = []

				const balanceData = (ERC20Method.BALANCE_OF + bytes20ToBytes32(accountAddress).slice(2)) as HexString
				const balanceSlot = getRecordedStorageSlot(chain, tokenAddress, balanceData)
				if (balanceSlot) {
					stateDiffs.push({ slot: balanceSlot, value: testValue })
				}

				try {
					const allowanceData = (ERC20Method.ALLOWANCE +
						bytes20ToBytes32(accountAddress).slice(2) +
						bytes20ToBytes32(spenderAddress).slice(2)) as HexString
					const allowanceSlot = getRecordedStorageSlot(chain, tokenAddress, allowanceData)
					if (allowanceSlot) {
						stateDiffs.push({ slot: allowanceSlot, value: testValue })
					}
				} catch (e) {
					console.warn(`Could not find allowance slot for token ${tokenAddress}:`, e)
				}

				overrides.push({ address: tokenAddress, stateDiff: stateDiffs })
			} catch (e) {
				console.warn(`Could not find balance slot for token ${tokenAddress}:`, e)
			}
		}

		return overrides
	}

	/**
	 * Converts gas costs to the equivalent amount in the fee token (DAI).
	 * Uses USD pricing to convert between native token gas costs and fee token amounts.
	 *
	 * @param gasEstimate - The estimated gas units
	 * @param gasEstimateIn - Whether to use "source" or "dest" chain for the conversion
	 * @param evmChainID - The EVM chain ID in format "EVM-{id}"
	 * @returns The gas cost converted to fee token amount
	 * @private
	 */
	private async convertGasToFeeToken(
		gasEstimate: bigint,
		gasEstimateIn: "source" | "dest",
		evmChainID: string,
	): Promise<bigint> {
		const client = this[gasEstimateIn].client
		const gasPrice = await retryPromise(() => client.getGasPrice(), { maxRetries: 3, backoffMs: 250 })
		const gasCostInWei = gasEstimate * gasPrice
		const wethAddr = this[gasEstimateIn].configService.getWrappedNativeAssetWithDecimals(evmChainID).asset
		const feeToken = this.feeTokenCache.get(evmChainID)!

		try {
			const { amountOut } = await this.swap.findBestProtocolWithAmountIn(
				this[gasEstimateIn].client,
				wethAddr,
				feeToken.address,
				gasCostInWei,
				evmChainID,
				{ selectedProtocol: "v2" },
			)
			if (amountOut === 0n) {
				console.log("Amount out not found")
				throw new Error()
			}
			return amountOut
		} catch {
			// Testnet block
			const nativeCurrency = client.chain?.nativeCurrency
			const chainId = Number.parseInt(evmChainID.split("-")[1])
			const gasCostInToken = new Decimal(formatUnits(gasCostInWei, nativeCurrency?.decimals!))
			console.log("nativeCurrency?.symbol!", nativeCurrency?.symbol!)
			const tokenPriceUsd = await fetchPrice("pol", chainId)
			const gasCostUsd = gasCostInToken.times(tokenPriceUsd)
			const feeTokenPriceUsd = new Decimal(1) // stable coin
			const gasCostInFeeToken = gasCostUsd.dividedBy(feeTokenPriceUsd)
			return parseUnits(gasCostInFeeToken.toFixed(feeToken.decimals), feeToken.decimals)
		}
	}

	/**
	 * Gets a quote for the native token cost of dispatching a post request.
	 *
	 * @param postRequest - The post request to quote
	 * @param fee - The fee amount in fee token
	 * @returns The native token amount required
	 */
	private async quoteNative(postRequest: IPostRequest, fee: bigint): Promise<bigint> {
		const dispatchPost: DispatchPost = {
			dest: toHex(postRequest.dest),
			to: postRequest.to,
			body: postRequest.body,
			timeout: postRequest.timeoutTimestamp,
			fee: fee,
			payer: postRequest.from,
		}

		const quoteNative = await this.dest.client.readContract({
			address: this.dest.configService.getIntentGatewayAddress(postRequest.dest),
			abi: IntentGateway.ABI,
			functionName: "quoteNative",
			args: [dispatchPost] as any,
		})

		return quoteNative
	}

	/**
	 * Transforms an OrderV2 (SDK type) to the Order struct expected by the contract.
	 * - Removes SDK-specific fields (id, transactionHash)
	 * - Converts source/destination to hex if not already
	 */
	private transformOrderForContract(order: OrderV2): Omit<OrderV2, "id" | "transactionHash"> {
		const { id: _id, transactionHash: _txHash, ...contractOrder } = order
		return {
			...contractOrder,
			source: order.source.startsWith("0x") ? order.source : toHex(order.source),
			destination: order.destination.startsWith("0x") ? order.destination : toHex(order.destination),
		}
	}
}
