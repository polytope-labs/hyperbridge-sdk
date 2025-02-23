import { StateMachineUpdatedLog } from "../../../types/abi-interfaces/EthereumHostAbi"
import { StateMachineService } from "../../../services/stateMachine.service"
import { getHostStateMachine } from "../../../utils/substrate.helpers"

/**
 * Handle the StateMachineUpdated event
 */
export async function handleStateMachineUpdatedEvent(event: StateMachineUpdatedLog): Promise<void> {
	if (!event.args) return

	const { blockHash, blockNumber, transactionHash, transactionIndex, block, args } = event
	const { stateMachineId, height } = args

	// todo: Get the timestamp of the state commitment
	logger.info(
		`Handling StateMachineUpdated Event: ${JSON.stringify({
			blockNumber,
			transactionHash,
		})}`,
	)

	const chain: string = getHostStateMachine(chainId)
	await StateMachineService.createEvmStateMachineUpdatedEvent(
		{
			transactionHash,
			transactionIndex,
			blockHash,
			blockNumber,
			timestamp: Number(block.timestamp),
			stateMachineId: stateMachineId,
			height: height.toNumber(),
		},
		chain,
	)
}
