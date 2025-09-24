import { SubstrateEvent } from "@subql/types"
import { RelayerReward } from "@/configs/src/types"
import { wrap } from "@/utils/event.utils"
import { Balance } from "@polkadot/types/interfaces"
import { RelayerService } from "@/services/relayer.service"

export const handleRelayerRewardedEvent = wrap(async (event: SubstrateEvent): Promise<void> => {
	const {
		event: { data, method },
		block,
		extrinsic,
		idx,
	} = event
	logger.info(`Relayer Rewarded Event ${method} event at block: ${block.block.header.number.toString()}`)

	const [relayer, amount, stateMachineHeight] = data

	const { id, height } = stateMachineHeight as any
	const { stateId, consensusStateId } = id

	const recordId = `${block.block.header.number.toString()}-${idx}`
	const relayerAddress = relayer.toString()
	const rewardAmount = (amount as unknown as Balance).toBigInt()
	const conStateId = consensusStateId.toString()
	const smHeight = BigInt(height.toString())
	const creationTimestamp = block.timestamp!
	const blockNumber = block.block.header.number.toBigInt()
	const txHash = extrinsic!.extrinsic.hash.toString()

	const record = RelayerReward.create({
		id: recordId,
		relayer: relayerAddress,
		amount: rewardAmount,
		stateMachine: stateId.toString(),
		consensusStateId: conStateId.toString(),
		height: smHeight,
		createdAt: creationTimestamp,
		blockNumber: blockNumber,
		transactionHash: txHash,
	})
	await record.save()

	const timestamp = new Date(block.timestamp!)
	logger.info(`Saving Relayer Rewarded Event ${method} event at block: ${record}`)
	await RelayerService.updateReward(relayerAddress, rewardAmount, timestamp)
	logger.info(`Finished updating reward for Relayer Rewarded Event ${method} event at block: ${record}`)
})
