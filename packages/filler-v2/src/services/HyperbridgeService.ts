import { ApiPromise, WsProvider, Keyring } from "@polkadot/api"
import type { BidSubmissionResult, HexString } from "@hyperbridge/sdk"
import { getLogger } from "./Logger"

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
	 * @returns KeyringPair for signing extrinsics
	 */
	private getKeyPair() {
		const keyring = new Keyring({ type: "sr25519" })

		// Check if the key contains spaces (mnemonic) or is a hex seed
		if (this.substratePrivateKey.includes(" ")) {
			// It's a mnemonic phrase
			return keyring.addFromMnemonic(this.substratePrivateKey)
		}
		// It's a hex seed (no 0x prefix expected)
		const seedBytes = Buffer.from(this.substratePrivateKey, "hex")
		return keyring.addFromSeed(seedBytes)
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
			const keyPair = this.getKeyPair()

			HyperbridgeService.logger.info(
				{
					commitment,
					userOpLength: userOp.length,
					signer: keyPair.address,
				},
				"Submitting bid to Hyperbridge",
			)

			// The pallet expects: commitment (H256), user_op (BoundedVec<u8, 1MB>)
			const extrinsic = this.api.tx.intents.placeBid(commitment, userOp)

			const result = await new Promise<BidSubmissionResult>((resolve) => {
				extrinsic
					.signAndSend(keyPair, { nonce: -1 }, (status) => {
						if (status.isInBlock || status.isFinalized) {
							HyperbridgeService.logger.info(
								{
									blockHash: status.status.asInBlock.toHex(),
									extrinsicHash: extrinsic.hash.toHex(),
								},
								"Bid included in block",
							)
							resolve({
								success: true,
								blockHash: status.status.asInBlock.toHex() as HexString,
								extrinsicHash: extrinsic.hash.toHex() as HexString,
							})
						} else if (status.isError) {
							HyperbridgeService.logger.error({ status: status.toHuman() }, "Bid submission error")
							resolve({
								success: false,
								error: `Extrinsic failed: ${status.status.toString()}`,
							})
						}
					})
					.catch((err: Error) => {
						HyperbridgeService.logger.error({ err }, "Failed to submit bid extrinsic")
						resolve({
							success: false,
							error: err.message,
						})
					})
			})

			return result
		} catch (error) {
			HyperbridgeService.logger.error({ err: error }, "Error submitting bid to Hyperbridge")
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		}
	}
}
