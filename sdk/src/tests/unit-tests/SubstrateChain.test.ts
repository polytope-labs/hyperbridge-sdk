import { SubstrateChain } from "../../chains/substrate"

describe("SubstrateChain", () => {
	it("should query request proof", async () => {
		const substrateChain = new SubstrateChain({
			ws: "wss://hyperbridge-nexus-rpc.blockops.network",
			hasher: "Keccak",
		})

		await substrateChain.connect()
		let substrateProof = await substrateChain.queryRequestsProof(
			["0x727e38ed0dc7a1b071ff21a1f96e5cff501600b4aff71a17adbdb23f2927988f"],
			"POLKADOT-42161",
			4149414n,
		)

		console.log({ substrateProof })

		let evmProof = await substrateChain.queryRequestsProof(
			["0x727e38ed0dc7a1b071ff21a1f96e5cff501600b4aff71a17adbdb23f2927988f"],
			"EVM-42161",
			4149414n,
		)

		console.log({ evmProof })
	})
})
