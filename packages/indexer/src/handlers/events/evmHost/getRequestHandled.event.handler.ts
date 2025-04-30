import { HyperBridgeService } from "@/services/hyperbridge.service"
import { Status } from "@/configs/src/types"
import { GetRequestHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { GetRequestService } from "@/services/getRequest.service"
import { getBlockTimestamp } from "@/utils/rpc.helpers"

/**
 * Handles the GetRequestHandled event from EVMHost
 */
export async function handleGetRequestHandledEvent(event: GetRequestHandledLog): Promise<void> {
	if (!event.args) return

	const { args, block, transactionHash, blockNumber, blockHash } = event
	const { relayer: relayer_id, commitment } = args

	logger.info(
		`Handling GetRequestHandled Event: ${JSON.stringify({
			blockNumber,
			transactionHash,
		})}`,
	)

	const chain = getHostStateMachine(chainId)
	const blockTimestamp = await getBlockTimestamp(blockHash, chain)

	await HyperBridgeService.handlePostRequestOrResponseHandledEvent(relayer_id, chain)

	await GetRequestService.updateStatus({
		commitment,
		chain,
		blockNumber: blockNumber.toString(),
		blockHash: block.hash,
		blockTimestamp,
		status: Status.DESTINATION,
		transactionHash,
	})
}
