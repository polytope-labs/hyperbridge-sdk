import { SubstrateEvent } from "@subql/types"
import { RelayerReward } from "@/configs/src/types"
import { RelayerService } from "@/services/relayer.service"
import { handleRelayerRewardedEvent } from "../incentives/relayerRewarded.event.handler"

jest.mock("@/services/relayer.service")
jest.mock("@/configs/src/types", () => ({
	RelayerReward: {
		create: jest.fn(),
	},
}))

;(global as any).logger = {
	info: jest.fn(),
	error: jest.fn(),
} as any

describe("handleRelayerRewardedEvent", () => {
	it("should create a RelayerReward record and call the RelayerService to update rewards", async () => {
		const mockSave = jest.fn()
		const mockRelayerRewardEntity = { id: "12345-0", save: mockSave }
		;(RelayerReward.create as jest.Mock).mockReturnValue(mockRelayerRewardEntity)

		const mockEvent = {
			block: {
				block: {
					header: {
						number: {
							toString: () => "12345",
							toBigInt: () => BigInt(12345),
						},
					},
				},
				timestamp: new Date("2025-09-24T10:00:00Z"),
			},
			event: {
				data: [
					{ toString: () => "12rx6bPnDypLve7o89VsXDZrUioRU5Hqw8W5E9LNWZ5XEBF1" },
					{ toBigInt: () => BigInt(5000) },
					{
						id: {
							stateId: { evm: 56, toString: () => '{"evm":56}' },
							consensusStateId: { toString: () => "0x42534330" },
						},
						height: { toString: () => "70000" },
					},
				],
				method: "RelayerRewarded",
			},
			extrinsic: {
				extrinsic: {
					hash: {
						toString: () => "0xabcdef123456",
					},
				},
			},
			idx: 0,
		} as unknown as SubstrateEvent

		await handleRelayerRewardedEvent(mockEvent)

		expect(RelayerReward.create).toHaveBeenCalledTimes(1)
		expect(RelayerReward.create).toHaveBeenCalledWith({
			id: "12345-0",
			relayer: "12rx6bPnDypLve7o89VsXDZrUioRU5Hqw8W5E9LNWZ5XEBF1",
			amount: BigInt(5000),
			stateMachine: '{"evm":56}',
			consensusStateId: "0x42534330",
			height: BigInt(70000),
			createdAt: new Date("2025-09-24T10:00:00Z"),
			blockNumber: BigInt(12345),
			transactionHash: "0xabcdef123456",
		})

		expect(mockSave).toHaveBeenCalledTimes(1)

		expect(RelayerService.updateReward).toHaveBeenCalledTimes(1)
		expect(RelayerService.updateReward).toHaveBeenCalledWith(
			"12rx6bPnDypLve7o89VsXDZrUioRU5Hqw8W5E9LNWZ5XEBF1",
			BigInt(5000),
			new Date("2025-09-24T10:00:00Z"),
		)
	})
})
