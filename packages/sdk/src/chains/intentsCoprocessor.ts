import { ApiPromise, Keyring, WsProvider } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { KeyringPair } from "@polkadot/keyring/types"
import { hexToU8a, u8aToHex, u8aConcat } from "@polkadot/util"
import { decodeAddress, keccakAsU8a } from "@polkadot/util-crypto"
import { Bytes, Struct, u8, Vector } from "scale-ts"
import type { BidSubmissionResult, HexString, PackedUserOperation, BidStorageEntry, FillerBid } from "@/types"
import type { SubstrateChain } from "./substrate"

/** SCALE codec for Bid { filler: AccountId, user_op: Vec<u8> } */
const BidCodec = Struct({ filler: Bytes(32), user_op: Vector(u8) })

/**
 * SCALE codec for PackedUserOperation
 * Uses Vec<u8> for all fields to handle hex strings uniformly
 */
const PackedUserOperationCodec = Struct({
	sender: Bytes(20), // address is 20 bytes
	nonce: Bytes(32), // uint256 as 32 bytes
	initCode: Vector(u8), // variable length bytes
	callData: Vector(u8), // variable length bytes
	accountGasLimits: Bytes(32), // bytes32
	preVerificationGas: Bytes(32), // uint256 as 32 bytes
	gasFees: Bytes(32), // bytes32
	paymasterAndData: Vector(u8), // variable length bytes
	signature: Vector(u8), // variable length bytes
})

/** Offchain storage key prefix for bids */
const OFFCHAIN_BID_PREFIX = new TextEncoder().encode("intents::bid::")

/** Helper to convert bigint to 32-byte big-endian Uint8Array */
function bigintToBytes32(value: bigint): Uint8Array {
	const bytes = new Uint8Array(32)
	let remaining = value
	for (let i = 31; i >= 0; i--) {
		bytes[i] = Number(remaining & 0xffn)
		remaining = remaining >> 8n
	}
	return bytes
}

/** Helper to convert 32-byte big-endian Uint8Array to bigint */
function bytes32ToBigint(bytes: Uint8Array): bigint {
	let result = 0n
	for (let i = 0; i < bytes.length; i++) {
		result = (result << 8n) | BigInt(bytes[i])
	}
	return result
}

/**
 * Encodes a PackedUserOperation using SCALE codec for submission to Hyperbridge.
 * This is the recommended way to encode UserOps for the intents coprocessor.
 *
 * @param userOp - The PackedUserOperation to encode
 * @returns Hex-encoded SCALE bytes
 */
export function encodeUserOpScale(userOp: PackedUserOperation): HexString {
	// Convert address (remove 0x, get 20 bytes)
	const senderBytes = hexToU8a(userOp.sender)

	// Convert nonce (bigint to 32 bytes)
	const nonceBytes = bigintToBytes32(userOp.nonce)

	// Convert variable-length bytes fields
	const initCodeBytes = hexToU8a(userOp.initCode)
	const callDataBytes = hexToU8a(userOp.callData)

	// Convert fixed-size bytes32 fields
	const accountGasLimitsBytes = hexToU8a(userOp.accountGasLimits)

	// Convert preVerificationGas (bigint to 32 bytes)
	const preVerificationGasBytes = bigintToBytes32(userOp.preVerificationGas)

	// Convert gasFees (bytes32)
	const gasFeesBytes = hexToU8a(userOp.gasFees)

	// Convert variable-length bytes fields
	const paymasterAndDataBytes = hexToU8a(userOp.paymasterAndData)
	const signatureBytes = hexToU8a(userOp.signature)

	const encoded = PackedUserOperationCodec.enc({
		sender: senderBytes,
		nonce: nonceBytes,
		initCode: Array.from(initCodeBytes),
		callData: Array.from(callDataBytes),
		accountGasLimits: accountGasLimitsBytes,
		preVerificationGas: preVerificationGasBytes,
		gasFees: gasFeesBytes,
		paymasterAndData: Array.from(paymasterAndDataBytes),
		signature: Array.from(signatureBytes),
	})

	return u8aToHex(encoded) as HexString
}

/**
 * Decodes a SCALE-encoded PackedUserOperation.
 *
 * @param hex - The hex-encoded SCALE bytes
 * @returns The decoded PackedUserOperation
 */
export function decodeUserOpScale(hex: HexString): PackedUserOperation {
	const decoded = PackedUserOperationCodec.dec(hexToU8a(hex))

	return {
		sender: u8aToHex(new Uint8Array(decoded.sender)) as HexString,
		nonce: bytes32ToBigint(new Uint8Array(decoded.nonce)),
		initCode: u8aToHex(new Uint8Array(decoded.initCode)) as HexString,
		callData: u8aToHex(new Uint8Array(decoded.callData)) as HexString,
		accountGasLimits: u8aToHex(new Uint8Array(decoded.accountGasLimits)) as HexString,
		preVerificationGas: bytes32ToBigint(new Uint8Array(decoded.preVerificationGas)),
		gasFees: u8aToHex(new Uint8Array(decoded.gasFees)) as HexString,
		paymasterAndData: u8aToHex(new Uint8Array(decoded.paymasterAndData)) as HexString,
		signature: u8aToHex(new Uint8Array(decoded.signature)) as HexString,
	}
}

/**
 * Service for interacting with Hyperbridge's pallet-intents coprocessor.
 * Handles bid submission and retrieval for the IntentGatewayV2 protocol.
 *
 * Can be created from an existing SubstrateChain instance to share the connection.
 */
export class IntentsCoprocessor {
	/**
	 * Creates and connects an IntentsCoprocessor to a Hyperbridge node.
	 * This creates and manages its own API connection.
	 *
	 * @param wsUrl - WebSocket URL of the Hyperbridge node
	 * @param substratePrivateKey - Private key for signing extrinsics (optional for read-only operations)
	 * @returns Promise resolving to a connected IntentsCoprocessor
	 */
	static async connect(wsUrl: string, substratePrivateKey?: string): Promise<IntentsCoprocessor> {
		const api = await ApiPromise.create({
			provider: new WsProvider(wsUrl),
			typesBundle: {
				spec: {
					gargantua: { hasher: keccakAsU8a },
				},
			},
		})
		return new IntentsCoprocessor(api, substratePrivateKey, true)
	}

	/**
	 * Creates an IntentsCoprocessor from an existing SubstrateChain instance.
	 * This shares the connection - the SubstrateChain must already be connected.
	 *
	 * @param chain - Connected SubstrateChain instance (typically Hyperbridge)
	 * @param substratePrivateKey - Private key for signing extrinsics (optional for read-only operations)
	 */
	static fromSubstrateChain(chain: SubstrateChain, substratePrivateKey?: string): IntentsCoprocessor {
		if (!chain.api) {
			throw new Error("SubstrateChain must be connected before creating IntentsCoprocessor")
		}
		return new IntentsCoprocessor(chain.api, substratePrivateKey, false)
	}

	/**
	 * Creates an IntentsCoprocessor from an existing ApiPromise instance.
	 *
	 * @param api - Connected ApiPromise instance
	 * @param substratePrivateKey - Private key for signing extrinsics (optional for read-only operations)
	 */
	static fromApi(api: ApiPromise, substratePrivateKey?: string): IntentsCoprocessor {
		return new IntentsCoprocessor(api, substratePrivateKey, false)
	}

	private constructor(
		private api: ApiPromise,
		private substratePrivateKey?: string,
		private ownsConnection: boolean = false,
	) {}

	/**
	 * Disconnects the underlying API connection if this instance owns it.
	 * Only disconnects if created via `connect()`, not when using shared connections.
	 */
	async disconnect(): Promise<void> {
		if (this.ownsConnection) {
			await this.api.disconnect()
		}
	}

	/**
	 * Creates a Substrate keypair from the configured private key
	 * Supports both hex seed (without 0x prefix) and mnemonic phrases
	 */
	public getKeyPair(): KeyringPair {
		if (!this.substratePrivateKey) {
			throw new Error("Substrate PrivateKey Required")
		}

		const keyring = new Keyring({ type: "sr25519" })

		if (this.substratePrivateKey.includes(" ")) {
			return keyring.addFromMnemonic(this.substratePrivateKey)
		}
		const seedBytes = Buffer.from(this.substratePrivateKey, "hex")
		return keyring.addFromSeed(seedBytes)
	}

	/**
	 * Signs and sends an extrinsic, handling status updates and errors
	 */
	private async signAndSendExtrinsic(extrinsic: SubmittableExtrinsic<"promise">): Promise<BidSubmissionResult> {
		const keyPair = this.getKeyPair()
		const tip = 1_000_000_007n // 1 GWEI tip to increase priority

		return new Promise<BidSubmissionResult>((resolve) => {
			extrinsic
				.signAndSend(keyPair, { tip }, (result) => {
					if (result.status.isInBlock) {
						resolve({
							success: true,
							blockHash: result.status.asInBlock.toHex() as HexString,
							extrinsicHash: extrinsic.hash.toHex() as HexString,
						})
					} else if (result.dispatchError) {
						resolve({
							success: false,
							error: `Dispatch error: ${result.dispatchError.toString()}`,
						})
					}
				})
				.catch((err: Error) => {
					resolve({ success: false, error: err.message })
				})
		})
	}

	/**
	 * Submits a bid to Hyperbridge's pallet-intents
	 *
	 * @param commitment - The order commitment hash (bytes32)
	 * @param userOp - The encoded PackedUserOperation as hex string
	 * @returns BidSubmissionResult with success status and block/extrinsic hash
	 */
	async submitBid(commitment: HexString, userOp: HexString): Promise<BidSubmissionResult> {
		try {
			const extrinsic = this.api.tx.intentsCoprocessor.placeBid(commitment, userOp)
			return await this.signAndSendExtrinsic(extrinsic)
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}

	/**
	 * Retracts a bid from Hyperbridge and reclaims the deposit
	 *
	 * Use this to remove unused quotes and claim back deposited BRIDGE tokens.
	 *
	 * @param commitment - The order commitment hash (bytes32)
	 * @returns BidSubmissionResult with success status and block/extrinsic hash
	 */
	async retractBid(commitment: HexString): Promise<BidSubmissionResult> {
		try {
			const extrinsic = this.api.tx.intentsCoprocessor.retractBid(commitment)
			return await this.signAndSendExtrinsic(extrinsic)
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}

	/**
	 * Fetches all bid storage entries for a given order commitment.
	 * Returns the on-chain data only (filler addresses and deposits).
	 *
	 * @param commitment - The order commitment hash (bytes32)
	 * @returns Array of BidStorageEntry objects
	 */
	async getBidStorageEntries(commitment: HexString): Promise<BidStorageEntry[]> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const entries = await (this.api.query.intentsCoprocessor.bids as any).entries(commitment)

		return entries.map(([storageKey, depositValue]: [any, any]) => ({
			commitment,
			filler: storageKey.args[1].toString() as string,
			deposit: BigInt(depositValue.toString()),
		}))
	}

	/**
	 * Fetches all bids for a given order commitment from Hyperbridge.
	 *
	 * @param commitment - The order commitment hash (bytes32)
	 * @returns Array of FillerBid objects containing filler address, userOp, and deposit
	 */
	async getBidsForOrder(commitment: HexString): Promise<FillerBid[]> {
		const storageEntries = await this.getBidStorageEntries(commitment)

		if (storageEntries.length === 0) {
			return []
		}

		const bids: FillerBid[] = []

		for (const entry of storageEntries) {
			try {
				const { filler, deposit } = entry

				const offchainKey = this.buildOffchainBidKey(commitment, filler)
				const offchainKeyHex = u8aToHex(offchainKey)

				// Fetch from offchain storage using PERSISTENT kind
				const offchainResult = await this.api.rpc.offchain.localStorageGet("PERSISTENT", offchainKeyHex)

				if (!offchainResult || offchainResult.isNone) {
					continue
				}

				const bidData = offchainResult.unwrap().toHex() as HexString
				const decoded = this.decodeBid(bidData)

				bids.push({
					filler: decoded.filler,
					userOp: decoded.userOp,
					deposit,
				})
			} catch {
				// Skip bids that fail to decode
				continue
			}
		}

		return bids
	}

	/** Decodes SCALE-encoded Bid struct and SCALE-encoded PackedUserOperation */
	private decodeBid(hex: HexString): { filler: string; userOp: PackedUserOperation } {
		const decoded = BidCodec.dec(hexToU8a(hex))
		const filler = new Keyring({ type: "sr25519" }).encodeAddress(new Uint8Array(decoded.filler))
		const userOpHex = u8aToHex(new Uint8Array(decoded.user_op)) as HexString

		// Decode UserOp using SCALE codec
		const userOp = decodeUserOpScale(userOpHex)

		return { filler, userOp }
	}

	/** Builds offchain storage key: "intents::bid::" + commitment + filler */
	private buildOffchainBidKey(commitment: HexString, filler: string): Uint8Array {
		return u8aConcat(OFFCHAIN_BID_PREFIX, hexToU8a(commitment), decodeAddress(filler))
	}
}
