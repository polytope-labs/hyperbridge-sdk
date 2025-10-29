import type { HexString } from "@/types"
import { StateMachine } from "@/utils"
import type { ApiPromise } from "@polkadot/api"
import type { SignerOptions } from "@polkadot/api/types"
import { hexToU8a, u8aToHex } from "@polkadot/util"
import { decodeAddress, keccakAsHex } from "@polkadot/util-crypto"
import { Bytes, Struct, u64 } from "scale-ts"
import { parseUnits } from "viem"

const MultiAccount = Struct({
	substrate_account: Bytes(32),
	evm_account: Bytes(20),
	dest_state_machine: StateMachine,
	timeout: u64,
	account_nonce: u64,
})

export type HyperbridgeTxEvents =
	| {
			kind: "Ready"
			transaction_hash: HexString
			message_id?: HexString
	  }
	| {
			kind: "Dispatched"
			transaction_hash: HexString
			block_number: bigint
			message_id?: HexString
			commitment: HexString
	  }
	| {
			kind: "Finalized"
			transaction_hash: HexString
			message_id?: HexString
			block_number?: bigint
			commitment?: HexString
	  }
	| {
			kind: "Error"
			error: unknown
	  }

const DECIMALS = 10
/**
 * Parameters for teleporting DOT from AssetHub to EVM-based destination
 */
export type XcmGatewayParams = {
	/**
	 * Destination state machine ID (chain ID) where assets will be teleported to
	 * This value identifies the specific EVM chain in the destination network
	 */
	destination: number

	/**
	 * The recipient address on the destination chain (in hex format)
	 * This is the EVM address that will receive the teleported assets
	 */
	recipient: HexString

	/**
	 * Amount of DOT to teleport
	 * This will be converted to the appropriate format internally
	 */
	amount: number

	/**
	 * Request timeout value in blocks or timestamp
	 * Specifies how long the teleport request remains valid before expiring
	 */
	timeout: bigint

	/**
	 * The parachain ID of the Hyperbridge
	 */
	paraId: number
}

/**
 * Teleports DOT tokens from AssetHub to Hyperbridge parachain
 * using XCM (Cross-Consensus Message Format) with transferAssetsUsingTypeAndThen.
 *
 * This function uses transferAssetsUsingTypeAndThen to construct XCM transfers with a custom
 * beneficiary structure that embeds Hyperbridge-specific parameters (sender account, recipient EVM address,
 * timeout, and nonce) within an X4 junction. The assets are transferred using LocalReserve transfer type.
 *
 * It handles the complete lifecycle of a teleport operation:
 * 1. Encoding Hyperbridge parameters into the beneficiary X4 junction
 * 2. Constructing the XCM transfer transaction using polkadotXcm pallet
 * 3. Transaction signing and broadcasting
 * 4. Yielding events about transaction status through a ReadableStream
 *
 * Note: There is no guarantee that both Dispatched and Finalized events will be yielded.
 * Consumers should listen for either one of these events instead of expecting both.
 *
 * @param sourceApi - Polkadot API instance connected to AssetHub
 * @param who - Sender's SS58Address address
 * @param options - Transaction signing options
 * @param params - Teleport parameters including destination, recipient, amount, timeout, and paraId
 * @yields {HyperbridgeTxEvents} Stream of events indicating transaction status
 */
export async function teleportDot(param_: {
	sourceApi: ApiPromise
	who: string
	xcmGatewayParams: XcmGatewayParams
	options: Partial<SignerOptions>
}): Promise<ReadableStream<HyperbridgeTxEvents>> {
	const { sourceApi, who, options, xcmGatewayParams: params } = param_
	const { nonce: accountNonce } = (await sourceApi.query.system.account(who)) as any

	const encoded_message = MultiAccount.enc({
		substrate_account: decodeAddress(who),
		evm_account: hexToU8a(params.recipient),
		dest_state_machine: { tag: "Evm", value: params.destination },
		timeout: params.timeout,
		account_nonce: accountNonce,
	})

	const message_id = keccakAsHex(encoded_message)

	// Set up the custom beneficiary with embedded Hyperbridge parameters
	const beneficiary = {
		V3: {
			parents: 0,
			interior: {
				X4: [
					{
						AccountId32: {
							id: u8aToHex(decodeAddress(who)),
							network: null,
						},
					},
					{
						AccountKey20: {
							network: {
								Ethereum: {
									chainId: params.destination,
								},
							},
							key: params.recipient,
						},
					},
					{
						GeneralIndex: params.timeout,
					},
					{
						GeneralIndex: accountNonce,
					},
				],
			},
		},
	}

	// AssetHub -> Hyperbridge parachain destination and assets
	const destination = {
		V3: {
			parents: 1,
			interior: {
				X1: {
					Parachain: params.paraId,
				},
			},
		},
	}

	const assets = {
		V3: [
			{
				id: {
					Concrete: {
						parents: 1,
						interior: "Here",
					},
				},
				fun: {
					Fungible: parseUnits(params.amount.toString(), DECIMALS),
				},
			},
		],
	}

	const weightLimit = "Unlimited"

	// Use transferAssetsUsingTypeAndThen for AssetHub -> Hyperbridge transfer
	// This method allows us to specify custom beneficiary with embedded Hyperbridge parameters
	// TransferType: LocalReserve means assets are held in reserve on the source chain (AssetHub)
	const tx = sourceApi.tx.polkadotXcm.transferAssetsUsingTypeAndThen(
		destination,
		assets,
		{ LocalReserve: null }, // Assets transfer type
		assets.V3[0].id, // Fee asset ID
		{ LocalReserve: null }, // Remote fee transfer type
		beneficiary, // Custom beneficiary with X4 junction containing Hyperbridge parameters
		weightLimit,
	)

	let closed = false
	// Create the stream to report events
	let unsubscribe: () => void
	const stream = new ReadableStream<HyperbridgeTxEvents>(
		{
			async start(controller) {
				unsubscribe = await tx.signAndSend(who, options, async (result: any) => {
					try {
						const { status, dispatchError, txHash } = result

						if (dispatchError) {
							controller.enqueue({
								kind: "Error",
								error: `Error watching extrinsic: ${dispatchError.toString()}`,
							})
							unsubscribe?.()
							controller.close()
							closed = true
							return
						}

						if (status.isReady) {
							// Send tx hash as soon as it is available
							controller.enqueue({
								kind: "Ready",
								transaction_hash: txHash.toHex(),
								message_id,
							})
						} else if (status.isInBlock || status.isFinalized) {
							// Send event with the status kind (either Dispatched or Finalized)
							controller.enqueue({
								kind: "Finalized",
								transaction_hash: txHash.toHex(),
								message_id,
							})

							// We can end the stream because indexer only indexes finalized events from hyperbridge
							closed = true
							unsubscribe?.()
							controller.close()
							return
						}
					} catch (err) {
						// For some unknown reason the call back is called again after unsubscribing, this check prevents it from trying to push an event to the closed stream
						if (closed) {
							return
						}
						controller.enqueue({
							kind: "Error",
							error: String(err),
						})
					}
				})
			},
			cancel() {
				// This is called if the reader cancels,
				unsubscribe?.()
			},
		},
		{
			highWaterMark: 3,
			size: () => 1,
		},
	)

	return stream
}
