import "log-timestamp"

import { ApiPromise, WsProvider } from "@polkadot/api"
import { Keyring } from "@polkadot/keyring"
import type { HexString, AssetTeleported, AssetTeleportedResponse, ClientConfig } from "@/types"
import { teleportDot } from "@/utils/xcmGateway"
import type { Signer, SignerResult } from "@polkadot/api/types"
import type { SignerPayloadRaw } from "@polkadot/types/types"
import { u8aToHex, hexToU8a } from "@polkadot/util"
import type { KeyringPair } from "@polkadot/keyring/types"
import { IndexerClient } from "@/client"

// private key for testnet transactions
const secret_key = process.env.SECRET_PHRASE || ""

/**
 * Jest test for the teleport function
 The goal of this test is to ensure the teleport extrinsic is correctly encoded
 The tx can be decoded by the rpc node
 */
describe("teleport DOT", () => {
	// Common params for both tests
	const params = {
		destination: 97,
		recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as HexString,
		amount: BigInt(1),
		timeout: BigInt(3600),
		paraId: 4009,
	}

	it("should teleport DOT using indexer client", async () => {
		// Set up the connection to a local node
		const relayProvider = new WsProvider(process.env.PASEO_RPC_URL)
		const relayApi = await ApiPromise.create({ provider: relayProvider })

		const wsProvider = new WsProvider(process.env.HYPERBRIDGE_GARGANTUA)
		const hyperbridge = await ApiPromise.create({ provider: wsProvider })

		console.log("Api connected")
		// Set up BOB account from keyring
		const keyring = new Keyring({ type: "sr25519" })
		const bob = keyring.addFromUri(secret_key)
		// Implement the Signer interface
		const signer: Signer = createKeyringPairSigner(bob)
		// Create a real indexer client for integration testing
		const indexerClient = new IndexerClient({
			url: "http://localhost:3100",
			pollInterval: 1000,
			source: {
				stateMachineId: "KUSAMA-2004", // Polkadot
				consensusStateId: "PAS0",
				rpcUrl: process.env.HYPERBRIDGE_GARGANTUA as string,
				host: "0x", // Not needed for this test
			},
			dest: {
				stateMachineId: `EVM-${params.destination}`, // BSC Chapel
				consensusStateId: "ETH0",
				rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
				host: "0x", // Not needed for this test
			},
			hyperbridge: {
				stateMachineId: "KUSAMA-4009", // Hyperbridge
				consensusStateId: "PAS0",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA as string,
			},
		})

		try {
			// Call the teleport function with indexer
			console.log("Teleport Dot with Indexer started")
			const result = await teleportDot(
				relayApi,
				hyperbridge,
				bob.address,
				{ signer },
				params,
				indexerClient,
				2000, // Poll interval
				true  // Wait for finalization
			)

			for await (const event of result) {
				console.log(event.kind)
				if (event.kind === "Error") {
					throw new Error(event.error as string)
				}

				if (event.kind === "Ready") {
					console.log(event)
				}

				if (event.kind === "Dispatched") {
					// Verify that required fields are present
					expect(event.commitment).toBeDefined()
					expect(event.block_number).toBeDefined()
					console.log(event)
				}

				if (event.kind === "Finalized") {
					// Verify that required fields are present
					expect(event.commitment).toBeDefined()
					expect(event.block_number).toBeDefined()
					console.log(event)
				}
			}
		} catch (error) {
			expect(error).toBeUndefined()
		}
	}, 300_000)
})

function createKeyringPairSigner(pair: KeyringPair): Signer {
	return {
		/**
		 * Signs a raw payload
		 */
		async signRaw({ data }: SignerPayloadRaw): Promise<SignerResult> {
			// Sign the data
			const signature = u8aToHex(pair.sign(hexToU8a(data), { withType: true }))

			return {
				id: 1,
				signature,
			}
		},
	}
}