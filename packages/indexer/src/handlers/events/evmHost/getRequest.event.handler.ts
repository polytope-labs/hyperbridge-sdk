import { GetRequestEventLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { HyperBridgeService } from "@/services/hyperbridge.service"
import { GetRequestService } from "@/services/getRequest.service"

/**
 * Handles the GetRequest event from Evm Hosts
 */
export async function handleGetRequestEvent(event: GetRequestEventLog): Promise<void> {
	logger.info(
		`Handling GetRequest Event: ${JSON.stringify({
			event,
		})}`,
	)
	if (!event.args) return

	const { blockNumber, transactionHash, args, block } = event
	let { source, dest, from, keys, nonce, height, context, timeoutTimestamp, fee } = args
	let { hash, timestamp } = block

	// Get chain ID from the event's address
	const chainId = event.address
	if (!chainId) {
		logger.error(`Chain ID not found for event address`)
		return
	}

	const chain: string = getHostStateMachine(chainId)

	// Update HyperBridge stats
	await HyperBridgeService.incrementNumberOfSentMessages(chain)

	logger.info(
		`Processing GetRequest Event: ${JSON.stringify({
			source,
			dest,
			from,
			keys,
			nonce,
			height,
			context,
			timeoutTimestamp,
			fee,
		})}`,
	)

	let get_request_commitment = GetRequestService.computeRequestCommitment(
		source,
		dest,
		BigInt(nonce.toString()),
		BigInt(height.toString()),
		BigInt(timeoutTimestamp.toString()),
		from,
		keys,
		context,
	)

	logger.info(
		`Get Request Commitment: ${JSON.stringify({
			commitment: get_request_commitment,
		})}`,
	)

	await GetRequestService.createGetRequest({
		id: get_request_commitment,
		source,
		dest,
		from,
		keys,
		nonce: BigInt(nonce.toString()),
		height: BigInt(height.toString()),
		context,
		timeoutTimestamp: BigInt(timeoutTimestamp.toString()),
		fee: BigInt(fee.toString()),
		transactionHash,
		blockNumber: blockNumber.toString(),
		blockHash: hash,
		blockTimestamp: timestamp,
	})
}
