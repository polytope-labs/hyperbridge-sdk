import { ApiPromise, WsProvider, Keyring } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import { hexToU8a, u8aToHex } from "@polkadot/util"
import { decodeAddress } from "@polkadot/util-crypto"
import { decodeAbiParameters } from "viem"
import type { BidSubmissionResult, HexString, PackedUserOperation, BidStorageEntry, FillerBid } from "@hyperbridge/sdk"
import { getLogger } from "./Logger"	
import { Bytes, Struct, u8, Vector } from "scale-ts"



/**
 * SCALE codec for the Bid struct from pallet-intents
 * Matches: Bid<AccountId> { filler: AccountId, user_op: Vec<u8> }
 */
const BidCodec = Struct({
	filler: Bytes(32),    // AccountId = [u8; 32] (fixed 32 bytes)
	user_op: Vector(u8),  // Vec<u8> with compact length prefix
})

/**
 * Service for interacting with Hyperbridge via Polkadot.js
 * Handles bid submission to the pallet-intents coprocessor.
 * Maintains a persistent WebSocket connection for efficiency.
 *
 * Use the static `create()` method to instantiate.
 */
export class HyperbridgeService {
	private static logger = getLogger("hyperbridge-service")

	/**
	 * Creates a new HyperbridgeService with an established connection.
	 * WsProvider handles auto-reconnect internally.
	 *
	 * @param wsUrl - WebSocket URL for Hyperbridge
	 * @param substratePrivateKey - Private key for signing extrinsics
	 */
	static async create(wsUrl: string, substratePrivateKey: string): Promise<HyperbridgeService> {
		this.logger.debug({ wsUrl }, "Connecting to Hyperbridge")
		const provider = new WsProvider(wsUrl)
		const api = await ApiPromise.create({ provider })
		await api.isReady
		this.logger.info("Connected to Hyperbridge")

		return new HyperbridgeService(api, substratePrivateKey)
	}

	private constructor(
		private api: ApiPromise,
		private substratePrivateKey: string,
	) {}

	/**
	 * Disconnects from Hyperbridge.
	 * Should be called when the filler is stopping.
	 */
	async disconnect(): Promise<void> {
		HyperbridgeService.logger.debug("Disconnecting from Hyperbridge")
		await this.api.disconnect()
		HyperbridgeService.logger.debug("Disconnected from Hyperbridge")
	}

	/**
	 * Creates a Substrate keypair from the configured private key
	 * Supports both hex seed (without 0x prefix) and mnemonic phrases
	 */
	private getKeyPair() {
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
	private async signAndSendExtrinsic(
		extrinsic: SubmittableExtrinsic<"promise">,
		successMessage: string,
		errorMessage: string,
	): Promise<BidSubmissionResult> {
		const keyPair = this.getKeyPair()

		return new Promise<BidSubmissionResult>((resolve) => {
			extrinsic
				.signAndSend(keyPair,  (status) => {
					if (status.isInBlock || status.isFinalized) {
						HyperbridgeService.logger.info(
							{
								blockHash: status.status.asInBlock.toHex(),
								extrinsicHash: extrinsic.hash.toHex(),
							},
							successMessage,
						)
						resolve({
							success: true,
							blockHash: status.status.asInBlock.toHex() as HexString,
							extrinsicHash: extrinsic.hash.toHex() as HexString,
						})
					} else if (status.isError) {
						HyperbridgeService.logger.error({ status: status.toHuman() }, errorMessage)
						resolve({
							success: false,
							error: `Extrinsic failed: ${status.status.toString()}`,
						})
					}
				})
				.catch((err: Error) => {
					HyperbridgeService.logger.error({ err }, errorMessage)
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
			HyperbridgeService.logger.info(
				{ commitment, userOpLength: userOp.length, signer: this.getKeyPair().address },
				"Submitting bid to Hyperbridge",
			)

			const extrinsic = this.api.tx.intents.placeBid(commitment, userOp)
			return await this.signAndSendExtrinsic(extrinsic, "Bid included in block", "Bid submission failed")
		} catch (error) {
			HyperbridgeService.logger.error({ err: error }, "Error submitting bid to Hyperbridge")
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
			HyperbridgeService.logger.info(
				{ commitment, signer: this.getKeyPair().address },
				"Retracting bid from Hyperbridge",
			)

			const extrinsic = this.api.tx.intents.retractBid(commitment)
			return await this.signAndSendExtrinsic(
				extrinsic,
				"Bid retracted, deposit refunded",
				"Bid retraction failed",
			)
		} catch (error) {
			HyperbridgeService.logger.error({ err: error }, "Error retracting bid from Hyperbridge")
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
		HyperbridgeService.logger.debug({ commitment }, "Fetching bid storage entries")

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
		HyperbridgeService.logger.debug({ commitment }, "Fetching bids for order commitment")

		try {
	
			const storageEntries = await this.getBidStorageEntries(commitment)

			if (storageEntries.length === 0) {
				HyperbridgeService.logger.debug({ commitment }, "No bids found for order")
				return []
			}

			HyperbridgeService.logger.debug({ fillerCount: storageEntries.length }, "Found fillers with bids")

			const bids: FillerBid[] = []

			for (const entry of storageEntries) {
				try {
					const { filler, deposit } = entry

					const offchainKey = this.buildOffchainBidKey(commitment, filler)
					const offchainKeyHex = u8aToHex(offchainKey)

					// Fetch from offchain storage using PERSISTENT kind
					const offchainResult = await this.api.rpc.offchain.localStorageGet("PERSISTENT", offchainKeyHex)

					if (!offchainResult || offchainResult.isNone) {
						HyperbridgeService.logger.warn(
							{ filler, commitment },
							"Bid exists on-chain but offchain data not found",
						)
						continue
					}

					const bidData = offchainResult.unwrap().toHex() as HexString
					const decoded = this.decodeBid(bidData)

					bids.push({
						filler: decoded.filler,
						userOp: decoded.userOp,
						deposit,
					})

					HyperbridgeService.logger.debug(
						{ filler: decoded.filler, userOpSender: decoded.userOp.sender, deposit: deposit.toString() },
						"Decoded bid",
					)
				} catch (err) {
					HyperbridgeService.logger.warn({ err, filler: entry.filler }, "Failed to decode bid, skipping")
				}
			}

			HyperbridgeService.logger.info({ commitment, bidCount: bids.length }, "Fetched bids for order")

			return bids
		} catch (error) {
			HyperbridgeService.logger.error({ err: error, commitment }, "Error fetching bids for order")
			throw error
		}
	}

	/**
	 * Decodes a SCALE-encoded Bid struct using scale-ts
	 * Bid { filler: AccountId (32 bytes), user_op: Vec<u8> }
	 */
	private decodeBid(hex: HexString): { filler: string; userOp: PackedUserOperation } {
		const bytes = hexToU8a(hex)


		const decoded = BidCodec.dec(bytes)

		const keyring = new Keyring({ type: "sr25519" })
		const filler = keyring.encodeAddress(new Uint8Array(decoded.filler))

		// Decode ABI-encoded PackedUserOperation from user_op bytes
		const userOpBytes = u8aToHex(new Uint8Array(decoded.user_op)) as HexString
		const userOp = this.decodePackedUserOperation(userOpBytes)

		return { filler, userOp }
	}

	/**
	 * Decodes an ABI-encoded PackedUserOperation
	 */
	private decodePackedUserOperation(hex: HexString): PackedUserOperation {
		const [sender, nonce, initCode, callData, accountGasLimits, preVerificationGas, gasFees, paymasterAndData, signature] =
			decodeAbiParameters(
				[
					{ type: "address", name: "sender" },
					{ type: "uint256", name: "nonce" },
					{ type: "bytes", name: "initCode" },
					{ type: "bytes", name: "callData" },
					{ type: "bytes32", name: "accountGasLimits" },
					{ type: "uint256", name: "preVerificationGas" },
					{ type: "bytes32", name: "gasFees" },
					{ type: "bytes", name: "paymasterAndData" },
					{ type: "bytes", name: "signature" },
				],
				hex,
			)

		return {
			sender: sender as HexString,
			nonce,
			initCode: initCode as HexString,
			callData: callData as HexString,
			accountGasLimits: accountGasLimits as HexString,
			preVerificationGas,
			gasFees: gasFees as HexString,
			paymasterAndData: paymasterAndData as HexString,
			signature: signature as HexString,
		}
	}

	/**
	 * Builds the offchain storage key for a bid.
	 *
	 * @param commitment - The order commitment hash (H256)
	 * @param filler - The filler's SS58 address
	 * @returns The offchain storage key as Uint8Array
	 */
	private buildOffchainBidKey(commitment: HexString, filler: string): Uint8Array {
		// Prefix: "intents::bid::"
		const prefix = new TextEncoder().encode("intents::bid::")

		// Commitment: H256 as raw bytes (32 bytes)
		const commitmentBytes = hexToU8a(commitment)

		// Filler: AccountId is [u8; 32] in Rust
		// SCALE encoding of fixed-size array = raw bytes (no length prefix)
		// decodeAddress converts SS58 address to raw 32-byte public key
		const fillerBytes = decodeAddress(filler)

		return this.u8aConcat(prefix, commitmentBytes, fillerBytes)
	}

	private u8aConcat(...arrays: Uint8Array[]): Uint8Array {
		const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
		const result = new Uint8Array(totalLength)
		let offset = 0
		for (const arr of arrays) {
			result.set(arr, offset)
			offset += arr.length
		}
		return result
	}
}
