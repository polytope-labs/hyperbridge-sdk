import { SubstrateEvent } from "@subql/types"
import { RelayerReward } from "@/configs/src/types"
import { Balance } from "@polkadot/types/interfaces"
import { DailyTreasuryRewardService } from "@/services/dailyTreasuryReward.service"

export async function handleFeeRewardedEvent(event: SubstrateEvent): Promise<void> {
	const {
		event: { data },
		block,
	} = event

	const [relayer, amount] = data
	const relayerAddress = relayer.toString()
	const rewardAmount = (amount as unknown as Balance).toBigInt()

	let record = await RelayerReward.get(relayerAddress)
	if (!record) {
		record = RelayerReward.create({
			id: relayerAddress,
		})
	}

	record.totalMessagingRewardAmount = (record.totalMessagingRewardAmount ?? BigInt(0)) + rewardAmount
	record.totalRewardAmount = (record.totalRewardAmount ?? BigInt(0)) + rewardAmount
	record.totalReputationAssetAmount = await DailyTreasuryRewardService.getReputationAssetBalance(relayerAddress)

	await record.save()

	const timestamp = new Date(block.timestamp!)
	await DailyTreasuryRewardService.update(timestamp, rewardAmount)
}
