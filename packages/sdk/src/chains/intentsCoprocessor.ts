import { ApiPromise, WsProvider, Keyring } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import { hexToU8a, u8aToHex, u8aConcat } from "@polkadot/util"
import { decodeAddress } from "@polkadot/util-crypto"
import { Bytes, Struct, u8, Vector } from "scale-ts"
import { decodeAbiParameters } from "viem"
import type { BidSubmissionResult, HexString, PackedUserOperation, BidStorageEntry, FillerBid } from "@/types"

/** SCALE codec for Bid { filler: AccountId, user_op: Vec<u8> } */
const BidCodec = Struct({ filler: Bytes(32), user_op: Vector(u8) })

/** Offchain storage key prefix for bids */
const OFFCHAIN_BID_PREFIX = new TextEncoder().encode("intents::bid::")

/**
 * Service for interacting with Hyperbridge's pallet-intents coprocessor.
 * Handles bid submission and retrieval for the IntentGatewayV2 protocol.
 * Maintains a persistent WebSocket connection for efficiency.
 *
 * Use the static `create()` method to instantiate.
 */
export class IntentsCoprocessor {
	/**
	 * Creates a new IntentsCoprocessor with an established connection.
	 * WsProvider handles auto-reconnect internally.
	 *
	 * @param wsUrl - WebSocket URL for Hyperbridge
	 * @param substratePrivateKey - Private key for signing extrinsics (optional for read-only operations)
	 */
	static async create(wsUrl: string, substratePrivateKey?: string): Promise<IntentsCoprocessor> {
		const provider = new WsProvider(wsUrl)
		const api = await ApiPromise.create({ provider })
		await api.isReady

		return new IntentsCoprocessor(api, substratePrivateKey)
	}

	private constructor(
		private api: ApiPromise,
		private substratePrivateKey?: string,
	) {}

	/**
	 * Disconnects from Hyperbridge.
	 * Should be called when done using the coprocessor.
	 */
	async disconnect(): Promise<void> {
		await this.api.disconnect()
	}

	/**
	 * Creates a Substrate keypair from the configured private key
	 * Supports both hex seed (without 0x prefix) and mnemonic phrases
	 */
	private getKeyPair() {
		if (!this.substratePrivateKey) {
			throw new Error("SubstratePrivateKeyRequired")
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

		return new Promise<BidSubmissionResult>((resolve) => {
			extrinsic
				.signAndSend(keyPair, (status) => {
					if (status.isInBlock || status.isFinalized) {
						resolve({
							success: true,
							blockHash: status.status.asInBlock.toHex() as HexString,
							extrinsicHash: extrinsic.hash.toHex() as HexString,
						})
					} else if (status.isError) {
						resolve({
							success: false,
							error: `Extrinsic failed: ${status.status.toString()}`,
						})
					}
				})
				.catch((err: Error) => {
					resolve({
						success: false,
						error: err.message,
					})
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
			const extrinsic = this.api.tx.intents.placeBid(commitment, userOp)
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
			const extrinsic = this.api.tx.intents.retractBid(commitment)
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
		const entries = await (this.api.query.intents.bids as any).entries(commitment)

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

	/** Decodes SCALE-encoded Bid struct and ABI-encoded PackedUserOperation */
	private decodeBid(hex: HexString): { filler: string; userOp: PackedUserOperation } {
		const decoded = BidCodec.dec(hexToU8a(hex))
		const filler = new Keyring({ type: "sr25519" }).encodeAddress(new Uint8Array(decoded.filler))
		const userOpHex = u8aToHex(new Uint8Array(decoded.user_op)) as HexString

		const [
			sender,
			nonce,
			initCode,
			callData,
			accountGasLimits,
			preVerificationGas,
			gasFees,
			paymasterAndData,
			signature,
		] = decodeAbiParameters(
			[
				{ type: "address" },
				{ type: "uint256" },
				{ type: "bytes" },
				{ type: "bytes" },
				{ type: "bytes32" },
				{ type: "uint256" },
				{ type: "bytes32" },
				{ type: "bytes" },
				{ type: "bytes" },
			],
			userOpHex,
		)

		return {
			filler,
			userOp: {
				sender: sender as HexString,
				nonce,
				initCode: initCode as HexString,
				callData: callData as HexString,
				accountGasLimits: accountGasLimits as HexString,
				preVerificationGas,
				gasFees: gasFees as HexString,
				paymasterAndData: paymasterAndData as HexString,
				signature: signature as HexString,
			},
		}
	}

	/** Builds offchain storage key: "intents::bid::" + commitment + filler */
	private buildOffchainBidKey(commitment: HexString, filler: string): Uint8Array {
		return u8aConcat(OFFCHAIN_BID_PREFIX, hexToU8a(commitment), decodeAddress(filler))
	}
}
