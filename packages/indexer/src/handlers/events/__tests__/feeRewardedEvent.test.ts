import { SubstrateEvent } from "@subql/types"
import { HyperbridgeRelayerReward } from "@/configs/src/types"
import { DailyTreasuryRewardService } from "@/services/dailyTreasuryReward.service"
import { handleFeeRewardedEvent } from "../incentives/feeRewarded.event.handler"

jest.mock("@/configs/src/types", () => ({
	HyperbridgeRelayerReward: {
		get: jest.fn(),
		create: jest.fn(),
	},
}))

jest.mock("@/services/dailyTreasuryReward.service", () => ({
	DailyTreasuryRewardService: {
		update: jest.fn(),
		getReputationAssetBalance: jest.fn(),
	},
}))

jest.mock("@/utils/rpc.helpers", () => ({
	getBlockTimestamp: jest.fn(),
}))

jest.mock("@/utils/substrate.helpers", () => ({
	getHostStateMachine: jest.fn(),
}))
;(global as any).logger = {
	info: jest.fn(),
	error: jest.fn(),
} as any
;(global as any).chainId = "hyperbridge-gargantua-1234"

const RelayerRewardMock = HyperbridgeRelayerReward as jest.Mocked<typeof HyperbridgeRelayerReward>
const DailyTreasuryRewardServiceMock = DailyTreasuryRewardService as jest.Mocked<typeof DailyTreasuryRewardService>

describe("handleFeeRewardedEvent (Unit Test)", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should create a new RelayerReward record if one does not exist", async () => {
		const relayerAddress = "12rx6bPnDypLve7o89VsXDZrUioRU5Hqw8W5E9LNWZ5XEBF1"
		const rewardAmount = BigInt(2000)
		const mockReputationBalance = BigInt(500)

		const mockSave = jest.fn()
		const mockNewEntity = {
			id: relayerAddress,
			relayer: relayerAddress,
			totalMessagingRewardAmount: BigInt(0),
			totalRewardAmount: BigInt(0),
			reputationAssetBalance: BigInt(0),
			save: mockSave,
			_name: "HyperbridgeRelayerReward",
		}

		RelayerRewardMock.get.mockResolvedValue(undefined)
		RelayerRewardMock.create.mockReturnValue(mockNewEntity as any)
		DailyTreasuryRewardServiceMock.getReputationAssetBalance.mockResolvedValue(mockReputationBalance)

		const mockEvent = {
			block: {
				timestamp: new Date(),
				block: { header: { number: { toString: () => "12345" }, hash: { toString: () => "12345" } } },
			},
			event: {
				data: [{ toString: () => relayerAddress }, { toBigInt: () => rewardAmount }],
				method: "FeeRewarded",
			},
		} as unknown as SubstrateEvent

		await handleFeeRewardedEvent(mockEvent)

		expect(RelayerRewardMock.get).toHaveBeenCalledWith(relayerAddress)
		expect(RelayerRewardMock.create).toHaveBeenCalledWith({
			id: relayerAddress,
		})

		expect(DailyTreasuryRewardService.getReputationAssetBalance).toHaveBeenCalledWith(relayerAddress)

		expect(mockNewEntity.totalMessagingRewardAmount).toBe(rewardAmount)
		expect(mockNewEntity.totalRewardAmount).toBe(rewardAmount)
		expect(mockNewEntity.reputationAssetBalance).toBe(mockReputationBalance)
		expect(mockSave).toHaveBeenCalledTimes(1)
	})

	it("should update an existing RelayerReward record if one exists", async () => {
		const relayerAddress = "12rx6bPnDypLve7o89VsXDZrUioRU5Hqw8W5E9LNWZ5XEBF1"
		const initialAmount = BigInt(3000)
		const newRewardAmount = BigInt(2000)
		const mockReputationBalance = BigInt(500)

		const mockSave = jest.fn()
		const mockExistingEntity = {
			id: relayerAddress,
			relayer: relayerAddress,
			totalMessagingRewardAmount: initialAmount,
			totalRewardAmount: initialAmount,
			reputationAssetBalance: BigInt(0),
			save: mockSave,
			_name: "HyperbridgeRelayerReward",
		}

		RelayerRewardMock.get.mockResolvedValue(mockExistingEntity as any)
		DailyTreasuryRewardServiceMock.getReputationAssetBalance.mockResolvedValue(mockReputationBalance)

		const mockEvent = {
			block: {
				timestamp: new Date(),
				block: { header: { number: { toString: () => "12346" }, hash: { toString: () => "12345" } } },
			},
			event: {
				data: [{ toString: () => relayerAddress }, { toBigInt: () => newRewardAmount }],
				method: "FeeRewarded",
			},
		} as unknown as SubstrateEvent

		await handleFeeRewardedEvent(mockEvent)

		expect(RelayerRewardMock.get).toHaveBeenCalledWith(relayerAddress)
		expect(RelayerRewardMock.create).not.toHaveBeenCalled()

		expect(DailyTreasuryRewardService.getReputationAssetBalance).toHaveBeenCalledWith(relayerAddress)

		const expectedTotal = initialAmount + newRewardAmount
		expect(mockExistingEntity.totalMessagingRewardAmount).toBe(expectedTotal)
		expect(mockExistingEntity.totalRewardAmount).toBe(expectedTotal)
		expect(mockExistingEntity.reputationAssetBalance).toBe(mockReputationBalance)
		expect(mockSave).toHaveBeenCalledTimes(1)
	})
})
