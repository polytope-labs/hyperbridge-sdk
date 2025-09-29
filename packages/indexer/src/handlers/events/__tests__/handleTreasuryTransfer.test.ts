import { SubstrateEvent } from "@subql/types"
import { Treasury } from "@/configs/src/types"
import { handleTreasuryTransferEvent } from "../treasury/treasuryTransfer.event.handler"
import { DailyTreasuryRewardService } from "@/services/dailyTreasuryReward.service"

jest.mock("@/configs/src/types", () => ({
	Treasury: {
		get: jest.fn(),
		create: jest.fn(),
	},
}))

jest.mock("@/services/dailyTreasuryReward.service", () => ({
	DailyTreasuryRewardService: {
		getTreasuryBalance: jest.fn(),
	},
}))

jest.mock("@/utils/rpc.helpers", () => ({
	getBlockTimestamp: jest.fn(),
}))

jest.mock("@/utils/substrate.helpers", () => ({
	getHostStateMachine: jest.fn(),
}))

jest.mock("@/utils/date.helpers", () => ({
	timestampToDate: jest.fn(),
}))
;(global as any).logger = {
	info: jest.fn(),
	error: jest.fn(),
} as any
;(global as any).chainId = "hyperbridge-gargantua-1234"

const TreasuryMock = Treasury as jest.Mocked<typeof Treasury>
const DailyTreasuryRewardServiceMock = DailyTreasuryRewardService as jest.Mocked<typeof DailyTreasuryRewardService>

const TREASURY_ADDRESS = "13UVJyLkyUpEiXBx5p776dHQoBuuk3Y5PYp5Aa89rYWePWA3"
const OTHER_ADDRESS = "12rx6bPnDypLve7o89VsXDZrUioRU5Hqw8W5E9LNWZ5XEBF1"

describe("handleTreasuryTransfer (Unit Test)", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should create a new Treasury record on the first transfer (inflow)", async () => {
		const transferAmount = BigInt(10000)

		const mockSave = jest.fn()
		const mockNewEntity = {
			id: TREASURY_ADDRESS,
			totalAmountTransferredIn: BigInt(0),
			totalAmountTransferredOut: BigInt(0),
			totalBalance: BigInt(0),
			lastUpdatedAt: new Date(),
			save: mockSave,
			_name: "Treasury",
		}

		TreasuryMock.get.mockResolvedValue(undefined)
		TreasuryMock.create.mockReturnValue(mockNewEntity as any)
		DailyTreasuryRewardServiceMock.getTreasuryBalance.mockResolvedValue(transferAmount)

		const mockEvent = {
			block: {
				timestamp: new Date(),
				block: { header: { number: { toString: () => "12345" }, hash: { toString: () => "12345" } } },
			},
			event: {
				data: [
					{ toString: () => OTHER_ADDRESS },
					{ toString: () => TREASURY_ADDRESS },
					{ toBigInt: () => transferAmount },
				],
			},
		} as unknown as SubstrateEvent

		await handleTreasuryTransferEvent(mockEvent)

		expect(TreasuryMock.get).toHaveBeenCalledWith(TREASURY_ADDRESS)
		expect(TreasuryMock.create).toHaveBeenCalledTimes(1)

		expect(mockNewEntity.totalAmountTransferredIn).toBe(transferAmount)
		expect(mockNewEntity.totalAmountTransferredOut).toBe(BigInt(0))
		expect(mockNewEntity.totalBalance).toBe(transferAmount)
		expect(mockSave).toHaveBeenCalledTimes(1)
	})

	it("should update an existing Treasury record on an outflow", async () => {
		const initialIn = BigInt(10000)
		const initialOut = BigInt(2000)
		const outflowAmount = BigInt(3000)

		const mockSave = jest.fn()
		const mockExistingEntity = {
			id: TREASURY_ADDRESS,
			totalAmountTransferredIn: initialIn,
			totalAmountTransferredOut: initialOut,
			totalBalance: initialIn - initialOut,
			lastUpdatedAt: new Date(),
			save: mockSave,
			_name: "Treasury",
		}
		const mockTreasuryBalance = BigInt(5000)

		TreasuryMock.get.mockResolvedValue(mockExistingEntity as any)
		DailyTreasuryRewardServiceMock.getTreasuryBalance.mockResolvedValue(mockTreasuryBalance)

		const mockEvent = {
			block: {
				timestamp: new Date(),
				block: { header: { number: { toString: () => "12345" }, hash: { toString: () => "12345" } } },
			},
			event: {
				data: [
					{ toString: () => TREASURY_ADDRESS },
					{ toString: () => OTHER_ADDRESS },
					{ toBigInt: () => outflowAmount },
				],
			},
		} as unknown as SubstrateEvent

		await handleTreasuryTransferEvent(mockEvent)

		expect(TreasuryMock.get).toHaveBeenCalledWith(TREASURY_ADDRESS)
		expect(TreasuryMock.create).not.toHaveBeenCalled()

		const expectedOut = initialOut + outflowAmount
		const expectedBalance = initialIn - expectedOut

		expect(mockExistingEntity.totalAmountTransferredOut).toBe(expectedOut)
		expect(mockExistingEntity.totalBalance).toBe(expectedBalance)
		expect(mockSave).toHaveBeenCalledTimes(1)
	})
})
