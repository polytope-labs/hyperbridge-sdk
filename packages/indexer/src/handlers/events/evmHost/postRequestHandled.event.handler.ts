import { HyperBridgeService } from "@/services/hyperbridge.service"
import { Status, Transfer, Request } from "@/configs/src/types"
import { PostRequestHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { RequestService } from "@/services/request.service"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { wrap } from "@/utils/event.utils"
import { VolumeService } from "@/services/volume.service"
import { getPriceDataFromEthereumLog, isERC20TransferEvent, extractAddressFromTopic } from "@/utils/transfer.helpers"
import { TransferService } from "@/services/transfer.service"
import { safeArray } from "@/utils/data.helper"
import { findNextIsmpEventIndex, isWithinCurrentIsmpEventWindow } from "@/utils/ismp.helpers"
import { normalizeToEvmAddress } from "@/utils/transfer.helpers"

/**
 * Handles the PostRequestHandled event from Hyperbridge
 */
export const handlePostRequestHandledEvent = wrap(async (event: PostRequestHandledLog): Promise<void> => {
	if (!event.args) return

	const { args, block, transaction, transactionHash, transactionIndex, blockHash, blockNumber, data } = event
	const { relayer: relayer_id, commitment } = args

	logger.info(
		`Handling PostRequestHandled Event: ${stringify({
			blockNumber,
			transactionHash,
		})}`,
	)

	const chain = getHostStateMachine(chainId)
	const blockTimestamp = await getBlockTimestamp(blockHash, chain)

	try {
		await HyperBridgeService.handlePostRequestOrResponseHandledEvent(relayer_id, chain, blockTimestamp)

		await RequestService.updateStatus({
			commitment,
			chain,
			blockNumber: blockNumber.toString(),
			blockHash: block.hash,
			blockTimestamp,
			status: Status.DESTINATION,
			transactionHash,
		})

		const currentIndex = event.logIndex as number
		const nextIndex = findNextIsmpEventIndex(safeArray(transaction.logs), currentIndex, event.address)
		for (const log of safeArray(transaction.logs)) {
			if (!isWithinCurrentIsmpEventWindow(log as any, currentIndex, nextIndex)) continue
			if (!isERC20TransferEvent(log)) {
				continue
			}

			const value = BigInt(log.data)
			const transfer = await Transfer.get(log.transactionHash)

			if (!transfer) {
				const [_, fromTopic, toTopic] = log.topics
				const from = extractAddressFromTopic(fromTopic)
				const to = extractAddressFromTopic(toTopic)
				await TransferService.storeTransfer({
					transactionHash: log.transactionHash,
					chain,
					value,
					from,
					to,
				})

				const { symbol, amountValueInUSD } = await getPriceDataFromEthereumLog(
					log.address,
					value,
					blockTimestamp,
				)
				await VolumeService.updateVolume(`Transfer.${symbol}`, amountValueInUSD, blockTimestamp)

				// Contract (target) volume via ISMP Request 'to'
				const req = await Request.get(commitment)
				const contractTo = normalizeToEvmAddress(req?.to)
				if (contractTo) {
					await VolumeService.updateVolume(`Contract.${contractTo}`, amountValueInUSD, blockTimestamp)
				}
			}
		}
	} catch (error) {
		console.error(`Error handling PostRequestHandled event: ${stringify(error)}`)
	}
})
