import { encodeFunctionData, keccak256, toHex, encodeAbiParameters, concat, pad, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import IntentGatewayV2ABI from "@/abis/IntentGatewayV2"
import { createSessionKeyStorage, type SessionKeyData } from "@/storage"
import type { HexString, OrderV2, FillOptionsV2, PackedUserOperation, SubmitBidOptions } from "@/types"
import type { SessionKeyStorageOptions } from "@/storage/types"

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

		return this.encodePlaceOrderCalldata(order, graffiti)
	}

	/** Encodes placeOrder calldata */
	encodePlaceOrderCalldata(order: OrderV2, graffiti: HexString): HexString {
		return encodeFunctionData({
			abi: IntentGatewayV2ABI.ABI,
			functionName: "placeOrder",
			args: [
				{
					user: order.user,
					source: order.source,
					destination: order.destination,
					deadline: order.deadline,
					nonce: order.nonce,
					fees: order.fees,
					session: order.session,
					predispatch: {
						assets: order.predispatch.assets.map((a) => ({ token: a.token, amount: a.amount })),
						call: order.predispatch.call,
					},
					inputs: order.inputs.map((i) => ({ token: i.token, amount: i.amount })),
					output: {
						beneficiary: order.output.beneficiary,
						assets: order.output.assets.map((a) => ({ token: a.token, amount: a.amount })),
						call: order.output.call,
					},
				},
				graffiti,
			],
		}) as HexString
	}

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

		// EIP-712 structHash: keccak256(abi.encode(typehash, commitment, solver))
		const structHash = keccak256(
			encodeAbiParameters(
				[{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
				[SELECT_SOLVER_TYPEHASH, commitment, solverAddress],
			),
		)

		// EIP-712 digest: keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
		const digest = keccak256(concat(["0x1901" as Hex, domainSeparator as Hex, structHash]))

		// Sign raw digest (no Ethereum signed message prefix for EIP-712)
		const signature = await account.sign({ hash: digest })

		return signature as HexString
	}

	/** Encodes fillOrder calldata */
	encodeFillOrderCalldata(order: OrderV2, fillOptions: FillOptionsV2): HexString {
		return encodeFunctionData({
			abi: IntentGatewayV2ABI.ABI,
			functionName: "fillOrder",
			args: [
				{
					user: order.user,
					source: order.source,
					destination: order.destination,
					deadline: order.deadline,
					nonce: order.nonce,
					fees: order.fees,
					session: order.session,
					predispatch: {
						assets: order.predispatch.assets.map((a) => ({ token: a.token, amount: a.amount })),
						call: order.predispatch.call,
					},
					inputs: order.inputs.map((i) => ({ token: i.token, amount: i.amount })),
					output: {
						beneficiary: order.output.beneficiary,
						assets: order.output.assets.map((a) => ({ token: a.token, amount: a.amount })),
						call: order.output.call,
					},
				},
				{
					relayerFee: fillOptions.relayerFee,
					nativeDispatchFee: fillOptions.nativeDispatchFee,
					outputs: fillOptions.outputs.map((o: { token: HexString; amount: bigint }) => ({
						token: o.token,
						amount: o.amount,
					})),
				},
			],
		}) as HexString
	}

	/** Prepares a bid UserOperation for submitting to Hyperbridge (used by fillers/solvers) */
	async prepareSubmitBid(options: SubmitBidOptions): Promise<PackedUserOperation> {
		const { order, fillOptions, solverAccount, solverPrivateKey, nonce, entryPointAddress, chainId } = options

		// Default gas parameters
		const callGasLimit = 500000n
		const verificationGasLimit = 100000n
		const preVerificationGas = 21000n
		const maxPriorityFeePerGas = 1000000000n // 1 gwei
		const maxFeePerGas = 50000000000n // 50 gwei

		const callData = this.encodeFillOrderCalldata(order, fillOptions)
		const commitment = this.calculateOrderCommitmentV2(order)
		const accountGasLimits = packGasLimits(callGasLimit, verificationGasLimit)
		const gasFees = packGasFees(maxPriorityFeePerGas, maxFeePerGas)

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

		const userOpHash = computeUserOpHash(userOp, entryPointAddress, chainId)
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

	// =========================================================================
	// Session Key Management And Utilities
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

	/** Calculates the order commitment hash */
	calculateOrderCommitmentV2(order: OrderV2): HexString {
		const encoded = encodeAbiParameters(
			[
				{
					name: "order",
					type: "tuple",
					components: [
						{ name: "user", type: "bytes32" },
						{ name: "source", type: "bytes" },
						{ name: "destination", type: "bytes" },
						{ name: "deadline", type: "uint256" },
						{ name: "nonce", type: "uint256" },
						{ name: "fees", type: "uint256" },
						{ name: "session", type: "address" },
						{
							name: "predispatch",
							type: "tuple",
							components: [
								{
									name: "assets",
									type: "tuple[]",
									components: [
										{ name: "token", type: "bytes32" },
										{ name: "amount", type: "uint256" },
									],
								},
								{ name: "call", type: "bytes" },
							],
						},
						{
							name: "inputs",
							type: "tuple[]",
							components: [
								{ name: "token", type: "bytes32" },
								{ name: "amount", type: "uint256" },
							],
						},
						{
							name: "output",
							type: "tuple",
							components: [
								{ name: "beneficiary", type: "bytes32" },
								{
									name: "assets",
									type: "tuple[]",
									components: [
										{ name: "token", type: "bytes32" },
										{ name: "amount", type: "uint256" },
									],
								},
								{ name: "call", type: "bytes" },
							],
						},
					],
				},
			],
			[
				{
					user: order.user,
					source: order.source,
					destination: order.destination,
					deadline: order.deadline,
					nonce: order.nonce,
					fees: order.fees,
					session: order.session,
					predispatch: { assets: order.predispatch.assets, call: order.predispatch.call },
					inputs: order.inputs,
					output: {
						beneficiary: order.output.beneficiary,
						assets: order.output.assets,
						call: order.output.call,
					},
				},
			],
		)

		return keccak256(encoded)
	}
}

/** Packs callGasLimit and verificationGasLimit into bytes32 */
export function packGasLimits(callGasLimit: bigint, verificationGasLimit: bigint): HexString {
	const callGasHex = pad(toHex(callGasLimit), { size: 16 })
	const verificationGasHex = pad(toHex(verificationGasLimit), { size: 16 })
	return concat([callGasHex, verificationGasHex]) as HexString
}

/** Packs maxPriorityFeePerGas and maxFeePerGas into bytes32 */
export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): HexString {
	const priorityFeeHex = pad(toHex(maxPriorityFeePerGas), { size: 16 })
	const maxFeeHex = pad(toHex(maxFeePerGas), { size: 16 })
	return concat([priorityFeeHex, maxFeeHex]) as HexString
}

/** Computes the userOpHash for ERC-4337 v0.7 PackedUserOperation */
export function computeUserOpHash(userOp: PackedUserOperation, entryPoint: HexString, chainId: bigint): HexString {
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
