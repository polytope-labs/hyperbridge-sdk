import fetch from "node-fetch"
import { hexToBytes } from "viem"

import { getBlockTimestamp, getEvmBlockTimestamp, getSubstrateBlockTimestamp } from "@/utils/rpc.helpers"
import { StateCommitment } from "@/utils/state-machine.helper"

// Mock the fetch module
jest.mock("node-fetch")
const mockFetch = fetch as jest.MockedFunction<typeof fetch>

// Mock StateCommitment.dec which decodes the state_getStorage response
jest.mock("@/utils/state-machine.helper", () => {
	const original = jest.requireActual("@/utils/state-machine.helper")
	return {
		...original,
		StateCommitment: {
			...original.StateCommitment,
			dec: jest.fn().mockReturnValue({
				timestamp: 1670431584000n,
				overlay_root: undefined,
				state_root: new Uint8Array([1, 2, 3, 4]),
			}),
		},
	}
})

describe("DecodeTimestampExtrinsic", () => {
	test.skip("should decode a substrate timestamp extrinsic", async () => {})
})

describe("Get Substrate Block Timestamp", () => {
	const storageKey =
		"0x103895530afb23bb607661426d55eb8bf0f16a60fa21b8baaa82ee16ed43643d152f8ee324562996c4c54324e6fcb86d02ee070000504153309973210000000000"
	const blockHash = "0xfc53c051dd3adc9b564fcf0e6bcfa00ecdb8faddcd5dfbd9e84f8e9c1c6f2f28"
	const mockResponseResult =
		"0xa41412680000000001326cf8e33f8d9a5bc9bf425e5b128ada9e31549312cfc974fd0f41275c52f865e17371830e06779cb19cd087221ec865d5705dfe5719610a1e064bc40f0cbee7"

	beforeEach(() => {
		jest.clearAllMocks()

		mockFetch.mockResolvedValue({
			json: jest.fn().mockResolvedValue({ jsonrpc: "2.0", id: 1, result: mockResponseResult }),
		} as any)
	})

	test("should get a valid milliseconds timestamp from a substrate block", async () => {
		const chain = "KUSAMA-4009"

		const timestamp = await getSubstrateBlockTimestamp(storageKey, blockHash, chain)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(StateCommitment.dec).toHaveBeenCalledWith(hexToBytes(mockResponseResult))
		expect(timestamp).toBe(1670431584n)
		expect(new Date(Number(timestamp * 1000n)).toISOString()).toBe("2022-12-07T16:46:24.000Z")
	})

	test("should handle API errors gracefully", async () => {
		const chain = "KUSAMA-4009"

		mockFetch.mockRejectedValueOnce(new Error("Network error"))

		await expect(getSubstrateBlockTimestamp(storageKey, blockHash, chain)).rejects.toThrow("Network error")
	})

	test("should handle invalid response format", async () => {
		const chain = "KUSAMA-4009"

		mockFetch.mockResolvedValueOnce({
			json: jest
				.fn()
				.mockResolvedValue({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Invalid parameters" } }),
		} as any)

		await expect(getSubstrateBlockTimestamp(storageKey, blockHash, chain)).rejects.toThrow("RPC error")
	})

	test("should throw error when no result is returned", async () => {
		const chain = "KUSAMA-4009"

		// Mock empty response
		mockFetch.mockResolvedValueOnce({
			json: jest.fn().mockResolvedValue({
				jsonrpc: "2.0",
				id: 1,
				result: null,
			}),
		} as any)

		await expect(getSubstrateBlockTimestamp(storageKey, blockHash, chain)).rejects.toThrow("Invalid response")
	})
})

describe("Get Evm Block Timestamp", () => {
	const blockHash = "0xfc53c051dd3adc9b564fcf0e6bcfa00ecdb8faddcd5dfbd9e84f8e9c1c6f2f28"

	beforeEach(() => {
		jest.clearAllMocks()

		mockFetch.mockResolvedValue({
			json: jest.fn().mockResolvedValue({
				jsonrpc: "2.0",
				id: 1,
				result: {
					timestamp: 1670431584000n,
					hash: `0x00`,
				},
			}),
		} as any)
	})

	test("should fetch the block timestamp by querying the block and extracing the timestamp", async () => {
		const chain = "EVM-97"

		const timestamp = await getEvmBlockTimestamp(blockHash, chain)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(timestamp).toBe(1670431584000n)
		expect(new Date(Number(timestamp)).toISOString()).toBe("2022-12-07T16:46:24.000Z")
	})

	test("should handle API errors gracefully", async () => {
		const chain = "EVM-97"

		mockFetch.mockRejectedValueOnce(new Error("Network error"))

		await expect(getEvmBlockTimestamp(blockHash, chain)).rejects.toThrow("Network error")
	})

	test("should handle invalid response format", async () => {
		const chain = "EVM-97"

		mockFetch.mockResolvedValueOnce({
			json: jest
				.fn()
				.mockResolvedValue({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Invalid parameters" } }),
		} as any)

		await expect(getEvmBlockTimestamp(blockHash, chain)).rejects.toThrow("RPC error")
	})

	test("should throw error when no timestamp is returned", async () => {
		const chain = "EVM-97"

		// Mock response with missing timestamp
		mockFetch.mockResolvedValueOnce({
			json: jest.fn().mockResolvedValue({
				jsonrpc: "2.0",
				id: 1,
				result: {
					hash: blockHash,
					// No timestamp
				},
			}),
		} as any)

		await expect(getEvmBlockTimestamp(blockHash, chain)).rejects.toThrow("Invalid response")
	})
})

describe("Get Block Timestamp", () => {
	const storageKey =
		"0x103895530afb23bb607661426d55eb8bf0f16a60fa21b8baaa82ee16ed43643d152f8ee324562996c4c54324e6fcb86d02ee070000504153309973210000000000"
	const blockHash = "0xfc53c051dd3adc9b564fcf0e6bcfa00ecdb8faddcd5dfbd9e84f8e9c1c6f2f28"
	const mockResponseResult =
		"0xa41412680000000001326cf8e33f8d9a5bc9bf425e5b128ada9e31549312cfc974fd0f41275c52f865e17371830e06779cb19cd087221ec865d5705dfe5719610a1e064bc40f0cbee7"

	beforeEach(() => {
		jest.clearAllMocks()

		mockFetch.mockResolvedValue({
			json: jest.fn().mockResolvedValue({ jsonrpc: "2.0", id: 1, result: mockResponseResult }),
		} as any)
	})

	test("should use pick the appropriate function based on the chain and fetch the timestamp", async () => {
		const chain = "KUSAMA-4009"

		const timestamp = await getBlockTimestamp(blockHash, chain, storageKey)

		expect(mockFetch).toHaveBeenCalledTimes(1)
		expect(timestamp).toBe(1670431584n)
	})
})
