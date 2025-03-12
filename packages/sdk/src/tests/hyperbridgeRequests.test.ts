import "log-timestamp"

import { HexString, RequestStatus, TimeoutStatus } from "@/types"
import {
	createWalletClient,
	http,
	createPublicClient,
	getContract,
	decodeFunctionData,
	parseEventLogs,
	parseUnits,
	keccak256,
	toHex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bscTestnet } from "viem/chains"
import PING_MODULE from "@/abis/pingModule"
import EVM_HOST from "@/abis/evmHost"
import HANDLER from "@/abis/handler"
import TOKEN_GATEWAY from "@/abis/tokenGateway"
import { WsProvider, ApiPromise, Keyring } from "@polkadot/api"
import { Signer, SignerResult } from "@polkadot/api/types"
import { IndexerClient } from "@/client"
import { teleportDot } from "@/utils/xcmGateway"
import { KeyringPair } from "@polkadot/keyring/types"
import { SignerPayloadRaw } from "@polkadot/types/types"
import { u8aToHex, hexToU8a } from "@polkadot/util"
import { postRequestCommitment } from "@/utils"

describe("Hyperbridge Requests", () => {
	let indexer: IndexerClient

	beforeAll(async () => {
		const { bscIsmpHost } = await bscSetup()
		indexer = new IndexerClient({
			dest: {
				consensusStateId: "BSC0",
				rpcUrl: process.env.BSC_CHAPEL!,
				stateMachineId: "EVM-97",
				host: bscIsmpHost.address,
			},
			source: {
				consensusStateId: "PARA",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
				stateMachineId: "KUSAMA-4009",
				hasher: "Keccak",
			},
			hyperbridge: {
				consensusStateId: "PARA",
				stateMachineId: "KUSAMA-4009",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
			},
			url: "http://localhost:3000",
			pollInterval: 1_000, // every second
		})
	})

	it("It should correctly monitor requests that originate from hyperbridge", async () => {
		const { bscTestnetClient, bscHandler, bscWalletClient } = await bscSetup()
		const { hyperbridge, relayApi, bob, signer } = await hyperbridgeSetup()
		const params = {
			destination: 97,
			recipient: bscWalletClient.account.address as HexString,
			amount: BigInt(5),
			timeout: BigInt(3600),
			paraId: 4009,
		}

		console.log("Beginning Hyperbridge Post Request Test")

		try {
			// Call the teleport function
			//
			console.log("Teleport Dot started")
			const result = await teleportDot(relayApi, hyperbridge, bob.address, { signer }, params)

			let commitment
			for await (const event of result) {
				if (event.kind === "Error") {
					throw new Error(event.error as string)
				}

				if (event.kind === "Ready") {
					console.log(event)
				}

				if (event.kind === "Dispatched") {
					console.log(event)
					commitment = event.commitment
					break
				}
			}

			expect(commitment).toBeDefined()

			console.log("Beginning Hyperbridge SDK tracking")

			let final_status
			for await (const status of indexer.postRequestStatusStream(commitment!)) {
				console.log(`Received status: ${status}`)
				switch (status.status) {
					case RequestStatus.HYPERBRIDGE_FINALIZED: {
						console.log(
							`Status ${status.status}, Transaction: https://testnet.bscscan.com/tx/${status.metadata.transactionHash}`,
						)
						const { args, functionName } = decodeFunctionData({
							abi: HANDLER.ABI,
							data: status.metadata.calldata,
						})

						expect(functionName).toBe("handlePostRequests")

						try {
							const hash = await bscHandler.write.handlePostRequests(args as any)
							await bscTestnetClient.waitForTransactionReceipt({
								hash,
								confirmations: 1,
							})

							console.log(`Transaction submitted: https://testnet.bscscan.com/tx/${hash}`)
						} catch (e) {
							console.error("Error self-relaying: ", e)
						}

						break
					}
					case RequestStatus.DESTINATION: {
						final_status = RequestStatus.DESTINATION
						console.log(
							`Status ${status.status}, Transaction: https://testnet.bscscan.com/tx/${status.metadata.transactionHash}`,
						)
						break
					}
				}
			}

			console.log(`Post request status stream has ended`)

			expect(final_status).toEqual(RequestStatus.DESTINATION)
		} catch (error) {
			console.log(`Error ${error}`)
			expect(error).toBeUndefined()
		} finally {
			await hyperbridge.disconnect()
			await relayApi.disconnect()
		}
	}, 700_000)

	it("It should correctly monitor requests that timeout from hyperbridge", async () => {
		const { hyperbridge, relayApi, bob, signer } = await hyperbridgeSetup()
		const params = {
			destination: 97,
			recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as HexString,
			amount: BigInt(1),
			timeout: BigInt(10),
			paraId: 4009,
		}

		console.log("Beginning Hyperbridge Post Request Timeout Test")

		try {
			// Call the teleport function
			//
			console.log("Teleport Dot started")
			const result = await teleportDot(relayApi, hyperbridge, bob.address, { signer }, params)

			let commitment
			for await (const event of result) {
				if (event.kind === "Error") {
					throw new Error(event.error as string)
				}

				if (event.kind === "Ready") {
					console.log(event)
				}

				if (event.kind === "Dispatched") {
					console.log(event)
					commitment = event.commitment
					break
				}
			}

			expect(commitment).toBeDefined()

			console.log("Beginning Hyperbridge SDK Timeout tracking")

			// Wait for request to be indexed
			for await (const status of indexer.postRequestStatusStream(commitment!)) {
				if (status.status) {
					break
				}
			}

			let final_status
			for await (const status of indexer.postRequestTimeoutStream(commitment!)) {
				final_status = status.status
				switch (status.status) {
					case TimeoutStatus.DESTINATION_FINALIZED_TIMEOUT: {
						console.log(
							`Status ${status.status}, Transaction: https://gargantua.statescan.io/extrinsics/${status.metadata?.transactionHash}`,
						)
						break
					}
					case TimeoutStatus.TIMED_OUT: {
						console.log(
							`Status ${status.status}, Transaction: https://gargantua.statescan.io/extrinsics/${status.metadata?.transactionHash}`,
						)
						break
					}
				}
			}

			expect(final_status).toEqual(TimeoutStatus.TIMED_OUT)
		} catch (error) {
			expect(error).toBeUndefined()
		} finally {
			await hyperbridge.disconnect()
			await relayApi.disconnect()
		}
	}, 600_000)

	it("should successfully deliver requests to Hyperbridge", async () => {
		const { bscTestnetClient, bscTokenGateway } = await bscSetup()
		console.log("\n\nSending Post Request\n\n")

		const encoder = new TextEncoder()
		const hash = await bscTokenGateway.write.teleport([
			{
				amount: parseUnits("1", 18),
				assetId: keccak256(encoder.encode("DOT")),
				data: "0x",
				dest: toHex("KUSAMA-4009"),
				nativeCost: BigInt(0),
				redeem: false,
				relayerFee: parseUnits("0", 18),
				timeout: BigInt(3600),
				to: "0xe95696ab27a7ffc9c1a9969003787c8e3c7dcd87aa36238082eb22e67ec0e4ce",
			},
		])

		const receipt = await bscTestnetClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log(`Transaction reciept: ${bscTestnet.blockExplorers.default.url}/tx/${hash}`)
		console.log("Block: ", receipt.blockNumber)

		// parse EvmHost PostRequestEvent emitted in the transcation logs
		const event = parseEventLogs({ abi: EVM_HOST.ABI, logs: receipt.logs })[0]

		if (event.eventName !== "PostRequestEvent") {
			throw new Error("Unexpected Event type")
		}

		const request = event.args
		console.log("PostRequestEvent", { request })
		const commitment = postRequestCommitment(request)

		let final_status
		for await (const status of indexer.postRequestStatusStream(commitment)) {
			switch (status.status) {
				case RequestStatus.SOURCE_FINALIZED: {
					console.log(
						`Status ${status.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.metadata.transactionHash}`,
					)
					break
				}

				case RequestStatus.DESTINATION: {
					final_status = status.status
					console.log(
						`Status ${status.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.metadata.transactionHash}`,
					)
					break
				}
			}
		}

		expect(final_status).toEqual(RequestStatus.DESTINATION)
	}, 600_000)

	it("should successfully timeout requests sent to Hyperbridge", async () => {
		const { bscTestnetClient, bscTokenGateway, bscHandler, bscIsmpHost } = await bscSetup()

		indexer = new IndexerClient({
			source: {
				consensusStateId: "BSC0",
				rpcUrl: process.env.BSC_CHAPEL!,
				stateMachineId: "EVM-97",
				host: bscIsmpHost.address,
			},
			dest: {
				consensusStateId: "PARA",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
				stateMachineId: "KUSAMA-4009",
				hasher: "Keccak",
			},
			hyperbridge: {
				consensusStateId: "PARA",
				stateMachineId: "KUSAMA-4009",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
			},
			url: "http://localhost:3000",
			pollInterval: 1_000, // every second
		})

		const { hyperbridge, relayApi, bob, signer } = await hyperbridgeSetup()

		console.log("\n\nSending Post Request\n\n")

		const encoder = new TextEncoder()
		const hash = await bscTokenGateway.write.teleport([
			{
				amount: parseUnits("1", 18),
				assetId: keccak256(encoder.encode("DOT")),
				data: "0x",
				dest: toHex("KUSAMA-4009"),
				nativeCost: BigInt(0),
				redeem: false,
				relayerFee: parseUnits("0", 18),
				timeout: BigInt(20),
				to: "0xe95696ab27a7ffc9c1a9969003787c8e3c7dcd87aa36238082eb22e67ec0e4ce",
			},
		])

		const receipt = await bscTestnetClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log(`Transaction reciept: ${bscTestnet.blockExplorers.default.url}/tx/${hash}`)
		console.log("Block: ", receipt.blockNumber)

		// parse EvmHost PostRequestEvent emitted in the transcation logs
		const event = parseEventLogs({ abi: EVM_HOST.ABI, logs: receipt.logs })[0]

		if (event.eventName !== "PostRequestEvent") {
			throw new Error("Unexpected Event type")
		}

		const request = event.args
		console.log("PostRequestEvent", { request })
		const commitment = postRequestCommitment(request)

		console.log("PostRequestCommitment", { commitment })

		// Wait for request to be indexed
		for await (const status of indexer.postRequestStatusStream(commitment)) {
			if (status.status) {
				break
			}
		}

		// Call the teleport function
		//
		console.log("Teleport Dot to trigger state machine update event on BSC")
		const params = {
			destination: 97,
			recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" as HexString,
			amount: BigInt(1),
			timeout: BigInt(3600),
			paraId: 4009,
		}
		const result = await teleportDot(relayApi, hyperbridge, bob.address, { signer }, params)

		let hyp_commitment
		for await (const event of result) {
			if (event.kind === "Error") {
				throw new Error(event.error as string)
			}

			if (event.kind === "Ready") {
				console.log(event)
			}

			if (event.kind === "Dispatched") {
				console.log(event)
				hyp_commitment = event.commitment
				break
			}
		}

		expect(hyp_commitment).toBeDefined()

		let final_status
		for await (const timeout of indexer.postRequestTimeoutStream(commitment!)) {
			final_status = timeout.status
			switch (timeout.status) {
				case TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT: {
					console.log(
						`Status ${timeout.status}, Transaction: https://testnet.bscscan.com/tx/${timeout.metadata?.transactionHash}`,
					)
					const { args, functionName } = decodeFunctionData({
						abi: HANDLER.ABI,
						data: timeout.metadata!.calldata! as any,
					})

					expect(functionName).toBe("handlePostRequestTimeouts")

					try {
						const hash = await bscHandler.write.handlePostRequestTimeouts(args as any)
						await bscTestnetClient.waitForTransactionReceipt({
							hash,
							confirmations: 1,
						})

						console.log(`Transaction timeout submitted: https://testnet.bscscan.com/tx/${hash}`)
					} catch (e) {
						console.error("Error self-relaying: ", e)
					}

					break
				}
			}
		}

		expect(final_status).toEqual(TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT)
	}, 600_000)
})

async function bscSetup() {
	const account = privateKeyToAccount(process.env.PRIVATE_KEY as any)

	const bscWalletClient = createWalletClient({
		chain: bscTestnet,
		account,
		transport: http(process.env.BSC_CHAPEL),
	})

	const bscTestnetClient = createPublicClient({
		chain: bscTestnet,
		transport: http(process.env.BSC_CHAPEL),
	})

	const bscPing = getContract({
		address: process.env.PING_MODULE_ADDRESS! as HexString,
		abi: PING_MODULE.ABI,
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	const bscTokenGateway = getContract({
		address: process.env.TOKEN_GATEWAY_ADDRESS! as HexString,
		abi: TOKEN_GATEWAY.ABI,
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	const bscIsmpHostAddress = await bscPing.read.host()

	const bscIsmpHost = getContract({
		address: bscIsmpHostAddress,
		abi: EVM_HOST.ABI,
		client: bscTestnetClient,
	})

	const bscHostParams = await bscIsmpHost.read.hostParams()

	const bscHandler = getContract({
		address: bscHostParams.handler,
		abi: HANDLER.ABI,
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	return {
		bscTestnetClient,
		account,
		bscHandler,
		bscIsmpHost,
		bscTokenGateway,
		bscWalletClient,
	}
}

async function hyperbridgeSetup() {
	// Set up the connection to a local node
	const relayProvider = new WsProvider(process.env.PASEO_RPC_URL)
	const relayApi = await ApiPromise.create({ provider: relayProvider })

	const wsProvider = new WsProvider(process.env.HYPERBRIDGE_GARGANTUA)
	const hyperbridge = await ApiPromise.create({ provider: wsProvider })

	// Set up BOB account from keyring
	const keyring = new Keyring({ type: "sr25519" })
	const bob = keyring.addFromUri(process.env.SECRET_PHRASE!)
	// Implement the Signer interface
	const signer: Signer = createKeyringPairSigner(bob)

	console.log("Apis connected")

	return {
		relayApi,
		hyperbridge,
		signer,
		bob,
	}
}

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
