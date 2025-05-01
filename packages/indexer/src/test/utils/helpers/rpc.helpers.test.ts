import { getBlockTimestamp, getEvmBlockTimestamp, getSubstrateBlockTimestamp } from "@/utils/rpc.helpers"

describe("Get Substrate Block Timestamp", () => {
	const chain = "KUSAMA-4009"
	const storageKey =
		"0x103895530afb23bb607661426d55eb8bf0f16a60fa21b8baaa82ee16ed43643d152f8ee324562996c4c54324e6fcb86d02ee070000504153309973210000000000"
	const blockHash = "0xfc53c051dd3adc9b564fcf0e6bcfa00ecdb8faddcd5dfbd9e84f8e9c1c6f2f28"

	test("should get a valid milliseconds timestamp from a substrate block", async () => {
		const timestamp = await getSubstrateBlockTimestamp(storageKey, blockHash, chain)

		expect(timestamp).toBe(1746015396n)
		expect(new Date(Number(timestamp * 1000n)).toISOString()).toBe("2025-04-30T12:16:36.000Z")
	})

	test("should handle API errors gracefully", async () => {
		await expect(getSubstrateBlockTimestamp("0x00", blockHash, chain)).rejects.toThrow(
			'Unexpected response: No result found in response {"jsonrpc":"2.0","id":1,"result":null}',
		)
	})

	test("should handle invalid chain parameter", async () => {
		await expect(getSubstrateBlockTimestamp(storageKey, blockHash, "UNKNOWN")).rejects.toThrow(
			"No RPC URL found for chain: UNKNOWN",
		)
	})

	test("should handle invalid blockHash parameter", async () => {
		await expect(getSubstrateBlockTimestamp(storageKey, "UNKNOWN", chain)).rejects.toThrow(
			"RPC error: Invalid params",
		)
	})
})

describe("Get Evm Block Timestamp", () => {
	const chain = "EVM-97"
	const blockHash = "0xcf2a760fab352596b2c3774658bdf57ffa34b7e8d8fe691732fffca29f98f5ef"

	test("should fetch the block timestamp by querying the block and extracing the timestamp", async () => {
		const timestamp = await getEvmBlockTimestamp(blockHash, chain)

		expect(timestamp).toBe(1746112524n)
		expect(new Date(Number(timestamp * 1000n)).toISOString()).toBe("2025-05-01T15:15:24.000Z")
	})

	test("should handle API errors gracefully", async () => {
		await expect(
			getEvmBlockTimestamp("0x0000000000000000000000000000000000000000000000000000000000000000", chain),
		).rejects.toThrow('Unexpected response: No timestamp found in response {"jsonrpc":"2.0","id":1,"result":null}')
	})

	test("should handle invalid chain parameter", async () => {
		await expect(getEvmBlockTimestamp(blockHash, "UNKNOWN")).rejects.toThrow("No RPC URL found for chain: UNKNOWN")
	})
})

describe("Get Block Timestamp", () => {
	const chain = "KUSAMA-4009"
	const storageKey =
		"0x103895530afb23bb607661426d55eb8bf0f16a60fa21b8baaa82ee16ed43643d152f8ee324562996c4c54324e6fcb86d02ee070000504153309973210000000000"
	const blockHash = "0xfc53c051dd3adc9b564fcf0e6bcfa00ecdb8faddcd5dfbd9e84f8e9c1c6f2f28"

	test("should use pick the appropriate function based on the chain and fetch the timestamp", async () => {
		expect(await getBlockTimestamp(blockHash, chain, storageKey)).toBe(1746015396n)
	})
})
