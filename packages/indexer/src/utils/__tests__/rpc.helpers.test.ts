import { ApiPromise, WsProvider } from "@polkadot/api"
import { keccakAsU8a } from "@polkadot/util-crypto"
import { getEvmTokenDecimals, getSubstrateTokenDecimals } from "../rpc.helpers"

describe("RPC Helpers", () => {
	afterEach(() => {
		;((globalThis as any).api as ApiPromise).disconnect()
	})

	it("getSubstrateTokenDecimals should properly get token decimals for BNC on Bifrost", async () => {
		;(globalThis as any).api = await ApiPromise.create({
			provider: new WsProvider("wss://bifrost.public.curie.radiumblock.co/ws"),
			typesBundle: {
				spec: {
					gargantua: {
						hasher: keccakAsU8a,
					},
				},
			},
		})

		const decimal = await getSubstrateTokenDecimals("BNC")
		expect(decimal).toBe(12)
	})

	it("getSubstrateTokenDecimals should properly get token decimals for CERE on Cere Network", async () => {
		;(globalThis as any).api = await ApiPromise.create({
			provider: new WsProvider("wss://rpc.mainnet.cere.network/ws"),
			typesBundle: {
				spec: {
					gargantua: {
						hasher: keccakAsU8a,
					},
				},
			},
		})

		const decimal = await getSubstrateTokenDecimals("CERE")
		expect(decimal).toBe(10)
	})

	it("getEvmTokenDecimals should fetch token decimals via the contract address on bsc testnet", async () => {
		const decimals = await getEvmTokenDecimals("EVM-97", "0xA801da100bF16D07F668F4A49E1f71fc54D05177")
		expect(decimals).toBe(18)
	})

	it("getEvmTokenDecimals should fetch token decimals via the contract address on gnosis", async () => {
		const decimals = await getEvmTokenDecimals("EVM-10200", "0x57f7E6ceAc40Aa078F4461ca7946d310A8642A3C")
		expect(decimals).toBe(6)
	})
})
