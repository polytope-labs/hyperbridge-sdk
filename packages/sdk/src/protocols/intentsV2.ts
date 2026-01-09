import {
	encodeFunctionData,
	keccak256,
	toHex,
	encodeAbiParameters,
	concat,
	pad,
	maxUint256,
	type Hex,
	type PublicClient,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import IntentGatewayV2ABI from "@/abis/IntentGatewayV2"
import { createSessionKeyStorage, type SessionKeyData } from "@/storage"
import type {
	HexString,
	OrderV2,
	PackedUserOperation,
	SubmitBidOptions,
	EstimateFillOrderV2Params,
	FillOrderEstimateV2,
} from "@/types"
import type { SessionKeyStorageOptions } from "@/storage/types"
import { ADDRESS_ZERO, bytes32ToBytes20, bytes20ToBytes32, ERC20Method, getStorageSlot } from "@/utils"

/** EIP-712 type hash for SelectSolver message */
export const SELECT_SOLVER_TYPEHASH = keccak256(toHex("SelectSolver(bytes32 commitment,address solver)"))

/** Default graffiti value (bytes32 zero) */
export const DEFAULT_GRAFFITI = "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString

/**
 * IntentGatewayV2 utilities for placing orders and submitting bids.
 * Automatically manages session keys for solver selection.
 */
export class IntentGatewayV2 {
	private readonly storage: ReturnType<typeof createSessionKeyStorage>

	constructor(storageOptions?: SessionKeyStorageOptions) {
		this.storage = createSessionKeyStorage(storageOptions)
	}

	// =========================================================================
	// Main Entry Points
	// =========================================================================

	/** Generates a session key, stores it, and returns encoded placeOrder calldata */
	async preparePlaceOrder(order: OrderV2, graffiti: HexString = DEFAULT_GRAFFITI): Promise<HexString> {
		const privateKey = generatePrivateKey()
		const account = privateKeyToAccount(privateKey)
		const sessionKeyAddress = account.address as HexString

		order.session = sessionKeyAddress

		const commitment = this.calculateOrderCommitmentV2(order)

		const sessionKeyData: SessionKeyData = {
			privateKey: privateKey as HexString,
			address: sessionKeyAddress,
			commitment,
			createdAt: Date.now(),
		}
		await this.storage.setSessionKey(commitment, sessionKeyData)

		return encodeFunctionData({
			abi: IntentGatewayV2ABI.ABI,
			functionName: "placeOrder",
			args: [order, graffiti],
		}) as HexString
	}

	/** Prepares a bid UserOperation for submitting to Hyperbridge (used by fillers/solvers) */
	async prepareSubmitBid(options: SubmitBidOptions): Promise<PackedUserOperation> {
		const {
			order,
			fillOptions,
			solverAccount,
			solverPrivateKey,
			nonce,
			entryPointAddress,
			chainId,
			callGasLimit,
			verificationGasLimit,
			preVerificationGas,
			maxFeePerGas,
			maxPriorityFeePerGas,
		} = options

		const callData = encodeFunctionData({
			abi: IntentGatewayV2ABI.ABI,
			functionName: "fillOrder",
			args: [order, fillOptions],
		}) as HexString
		const commitment = this.calculateOrderCommitmentV2(order)
		const accountGasLimits = this.packGasLimits(callGasLimit, verificationGasLimit)
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
		const messageHash = keccak256(concat([userOpHash, commitment, sessionKey as Hex]))

		const solverAccount_ = privateKeyToAccount(solverPrivateKey as Hex)
		const solverSignature = await solverAccount_.signMessage({ message: { raw: messageHash } })

		// Signature: commitment (32 bytes) + solverSignature (65 bytes)
		const signature = concat([commitment, solverSignature as Hex]) as HexString

		return { ...userOp, signature }
	}

	/** Estimates gas costs for fillOrder execution via ERC-4337 */
	async estimateFillOrderV2(params: EstimateFillOrderV2Params): Promise<FillOrderEstimateV2> {
		const { order, fillOptions, destClient, intentGatewayAddress, solverAccountAddress } = params

		const totalEthValue = order.output.assets
			.filter((output) => bytes32ToBytes20(output.token) === ADDRESS_ZERO)
			.reduce((sum, output) => sum + output.amount, 0n)

		const testValue = toHex(maxUint256 / 2n)
		const stateOverrides = await this.buildTokenStateOverrides(
			destClient,
			order.output.assets,
			solverAccountAddress,
			intentGatewayAddress,
			testValue,
		)

		// Add native balance override for the solver account
		stateOverrides.push({
			address: solverAccountAddress,
			balance: maxUint256,
		})

		// Estimate fillOrder gas (callGasLimit)
		let callGasLimit: bigint
		try {
			callGasLimit = await destClient.estimateContractGas({
				abi: IntentGatewayV2ABI.ABI,
				address: intentGatewayAddress,
				functionName: "fillOrder",
				args: [order, fillOptions],
				account: solverAccountAddress,
				value: totalEthValue + fillOptions.nativeDispatchFee,
				stateOverride: stateOverrides as any,
			})
		} catch (e) {
			console.warn("fillOrder gas estimation failed, using fallback:", e)
			callGasLimit = 500_000n
		}

		// Add buffer for execution through SolverAccount (20%)
		callGasLimit = callGasLimit + (callGasLimit * 20n) / 100n

		// Estimate verificationGasLimit for SolverAccount.validateUserOp
		const verificationGasLimit = 16_313n

		// Pre-verification gas (bundler overhead for calldata, etc.)
		const preVerificationGas = 21_000n

		// Get current gas prices
		const gasPrice = await destClient.getGasPrice()
		const maxFeePerGas = gasPrice + (gasPrice * 20n) / 100n
		const maxPriorityFeePerGas = gasPrice / 10n

		// Calculate total gas cost in wei
		const totalGas = callGasLimit + verificationGasLimit + preVerificationGas
		const totalGasCostWei = totalGas * maxFeePerGas

		return {
			callGasLimit,
			verificationGasLimit,
			preVerificationGas,
			maxFeePerGas,
			maxPriorityFeePerGas,
			totalGasCostWei,
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
	): Promise<HexString | null> {
		const sessionKeyData = await this.storage.getSessionKey(commitment)
		if (!sessionKeyData) {
			return null
		}

		const account = privateKeyToAccount(sessionKeyData.privateKey as Hex)

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

	/** Calculates the order commitment hash */
	calculateOrderCommitmentV2(order: OrderV2): HexString {
		const placeOrderAbi = IntentGatewayV2ABI.ABI.find(
			(item) => item.type === "function" && "name" in item && item.name === "placeOrder",
		)
		const orderType = placeOrderAbi?.inputs?.[0]
		if (!orderType) throw new Error("Could not find Order type in ABI")

		const encoded = encodeAbiParameters([orderType], [order])
		return keccak256(encoded)
	}

	/** Computes the userOpHash for ERC-4337 v0.7 PackedUserOperation */
	computeUserOpHash(userOp: PackedUserOperation, entryPoint: HexString, chainId: bigint): HexString {
		const packedUserOp = encodeAbiParameters(
			[
				{ type: "address" },
				{ type: "uint256" },
				{ type: "bytes32" },
				{ type: "bytes32" },
				{ type: "bytes32" },
				{ type: "uint256" },
				{ type: "bytes32" },
				{ type: "bytes32" },
			],
			[
				userOp.sender,
				userOp.nonce,
				keccak256(userOp.initCode),
				keccak256(userOp.callData),
				userOp.accountGasLimits as Hex,
				userOp.preVerificationGas,
				userOp.gasFees as Hex,
				keccak256(userOp.paymasterAndData),
			],
		)

		const userOpHashInner = keccak256(packedUserOp)

		const outerEncoded = encodeAbiParameters(
			[{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
			[userOpHashInner, entryPoint, chainId],
		)

		return keccak256(outerEncoded)
	}

	// =========================================================================
	// Gas Packing Utilities
	// =========================================================================

	/** Packs callGasLimit and verificationGasLimit into bytes32 */
	packGasLimits(callGasLimit: bigint, verificationGasLimit: bigint): HexString {
		const callGasHex = pad(toHex(callGasLimit), { size: 16 })
		const verificationGasHex = pad(toHex(verificationGasLimit), { size: 16 })
		return concat([callGasHex, verificationGasHex]) as HexString
	}

	/** Packs maxPriorityFeePerGas and maxFeePerGas into bytes32 */
	packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): HexString {
		const priorityFeeHex = pad(toHex(maxPriorityFeePerGas), { size: 16 })
		const maxFeeHex = pad(toHex(maxFeePerGas), { size: 16 })
		return concat([priorityFeeHex, maxFeeHex]) as HexString
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
	private async buildTokenStateOverrides(
		client: PublicClient,
		outputAssets: { token: HexString; amount: bigint }[],
		accountAddress: HexString,
		spenderAddress: HexString,
		testValue: HexString,
	): Promise<{ address: HexString; balance?: bigint; stateDiff?: { slot: HexString; value: HexString }[] }[]> {
		const overrides: { address: HexString; stateDiff: { slot: HexString; value: HexString }[] }[] = []

		for (const output of outputAssets) {
			const tokenAddress = bytes32ToBytes20(output.token)

			if (tokenAddress === ADDRESS_ZERO) {
				continue
			}

			try {
				const stateDiffs: { slot: HexString; value: HexString }[] = []

				const balanceData = (ERC20Method.BALANCE_OF + bytes20ToBytes32(accountAddress).slice(2)) as HexString
				const balanceSlot = (await getStorageSlot(client, tokenAddress, balanceData)) as HexString
				stateDiffs.push({ slot: balanceSlot, value: testValue })

				try {
					const allowanceData = (ERC20Method.ALLOWANCE +
						bytes20ToBytes32(accountAddress).slice(2) +
						bytes20ToBytes32(spenderAddress).slice(2)) as HexString
					const allowanceSlot = (await getStorageSlot(client, tokenAddress, allowanceData)) as HexString
					stateDiffs.push({ slot: allowanceSlot, value: testValue })
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
}
