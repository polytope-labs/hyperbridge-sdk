import { ApiPromise, WsProvider } from "@polkadot/api"
import { createPublicClient, http, PublicClient } from "viem"
import { bscTestnet, sepolia } from "viem/chains"
import { fetchStateCommitmentsEVM, fetchStateCommitmentsSubstrate } from "../../utils/state-machine.helper"

describe("fetchStateCommitmentsSubstrate Integration Test", () => {
	let api: ApiPromise

	beforeAll(async () => {
		const provider = new WsProvider("wss://hyperbridge-paseo-rpc.blockops.network")
		api = await ApiPromise.create({ provider })
	})

	afterAll(async () => {
		if (api) {
			await api.disconnect()
			await new Promise((resolve) => setTimeout(resolve, 1000)) // Give time for cleanup
		}
	})

	test("fetches real state commitment for EVM chain", async () => {
		// const stateMachineHeight = {
		// 	id: {
		// 		state_id: {
		// 			tag: "Kusama" as const,
		// 			value: 2030, // bifrost paseo testnet
		// 		},
		// 		consensus_state_id: [80, 65, 82, 65], // PARA
		// 	},
		// 	height: BigInt(1250399),
		// }

		const result = await fetchStateCommitmentsSubstrate({
			api,
			stateMachineId: "KUSAMA-2030",
			consensusStateId: "PARA",
			height: BigInt(1250399),
		})

		console.log(result)

		expect(result).toBeDefined()
		expect(result?.timestamp).toBeDefined()
		expect(result?.state_root).toBeInstanceOf(Uint8Array)
	}, 30000) // Increase timeout to 30 seconds
})

describe("fetchEvmStateCommitmentsFromHeight Integration Test", () => {
	let client: PublicClient

	beforeAll(() => {
		client = createPublicClient({
			chain: bscTestnet,
			transport: http(
				"https://wandering-delicate-silence.bsc-testnet.quiknode.pro/74d3977082e2021a0e005e12dbdcbb6732ed74ee",
			),
		})
	})

	test("fetches real state commitment for EVM chain", async () => {
		// const stateMachineHeight = {
		// 	id: {
		// 		state_id: {
		// 			tag: "Evm" as const,
		// 			value: 11155111, // Sepolia testnet
		// 		},
		// 		consensus_state_id: [69, 84, 72, 48], // ETH0
		// 	},
		// 	height: BigInt(100),
		// }

		const result = await fetchStateCommitmentsEVM({
			client,
			stateMachineId: "KUSAMA-4009",
			consensusStateId: "ETH0",
			height: BigInt(3663702),
		})

  console.log(result)

		expect(result).toBeDefined()
		expect(result?.timestamp).toBeDefined()
		expect(result?.state_root).toBeInstanceOf(Uint8Array)
	}, 30000) // Increase timeout to 30 seconds
})
