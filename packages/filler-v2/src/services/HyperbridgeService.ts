import { ApiPromise, WsProvider, Keyring } from "@polkadot/api"
import type { BidSubmissionResult, HexString } from "@hyperbridge/sdk"
import { getLogger } from "./Logger"

/**
 * Service for interacting with Hyperbridge via Polkadot.js
 * Handles bid submission to the pallet-intents coprocessor
 */
export class HyperbridgeService {
	private logger = getLogger("hyperbridge-service")
	private wsUrl: string
	private substratePrivateKey: string

	constructor(wsUrl: string, substratePrivateKey: string) {
		this.wsUrl = wsUrl
		this.substratePrivateKey = substratePrivateKey
	}

	/**
	 * Creates a connection to Hyperbridge
	 * @returns ApiPromise instance
	 */
	private async connect(): Promise<ApiPromise> {
		this.logger.debug({ wsUrl: this.wsUrl }, "Connecting to Hyperbridge")
		const provider = new WsProvider(this.wsUrl)
		const api = await ApiPromise.create({ provider })
		await api.isReady
		this.logger.debug("Connected to Hyperbridge")
		return api
	}

	/**
	 * Disconnects from Hyperbridge
	 * @param api The ApiPromise instance to disconnect
	 */
	private async disconnect(api: ApiPromise): Promise<void> {
		this.logger.debug("Disconnecting from Hyperbridge")
		await api.disconnect()
		this.logger.debug("Disconnected from Hyperbridge")
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
		let api: ApiPromise | null = null

		try {
			api = await this.connect()
			const keyPair = this.getKeyPair()

			this.logger.info(
				{
					commitment,
					userOpLength: userOp.length,
					signer: keyPair.address,
				},
				"Submitting bid to Hyperbridge",
			)

			// The pallet expects: commitment (H256), user_op (BoundedVec<u8, 1MB>)
			const extrinsic = api.tx.intents.placeBid(commitment, userOp)

			const result = await new Promise<BidSubmissionResult>((resolve) => {
				extrinsic
					.signAndSend(keyPair, { nonce: -1 }, (status) => {
						if (status.isInBlock) {
							this.logger.info(
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
							this.logger.error({ status: status.toHuman() }, "Bid submission error")
							resolve({
								success: false,
								error: `Extrinsic failed: ${status.status.toString()}`,
							})
						} else if (status.isFinalized) {
							this.logger.debug({ blockHash: status.status.asFinalized.toHex() }, "Bid finalized")
						}
					})
					.catch((err: Error) => {
						this.logger.error({ err }, "Failed to submit bid extrinsic")
						resolve({
							success: false,
							error: err.message,
						})
					})
			})

			return result
		} catch (error) {
			this.logger.error({ err: error }, "Error submitting bid to Hyperbridge")
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			}
		} finally {
			if (api) {
				await this.disconnect(api)
			}
		}
	}
}
