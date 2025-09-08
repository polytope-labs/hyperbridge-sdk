import { HyperBridgeService } from "@/services/hyperbridge.service"
import { Status } from "@/configs/src/types"
import { PostResponseHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { ResponseService } from "@/services/response.service"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { wrap } from "@/utils/event.utils"
import { Transfer, Response, Request } from "@/configs/src/types"
import { VolumeService } from "@/services/volume.service"
import { getPriceDataFromEthereumLog, isERC20TransferEvent, extractAddressFromTopic } from "@/utils/transfer.helpers"
import { TransferService } from "@/services/transfer.service"
import { safeArray } from "@/utils/data.helper"
import { findNextIsmpEventIndex, isWithinCurrentIsmpEventWindow } from "@/utils/ismp.helpers"
import { normalizeToEvmAddress } from "@/utils/transfer.helpers"

/**
 * Handles the PostResponseHandled event from Hyperbridge
 */
export const handlePostResponseHandledEvent = wrap(async (event: PostResponseHandledLog): Promise<void> => {
	if (!event.args) return

	const { args, block, transaction, transactionHash, transactionIndex, blockHash, blockNumber, data } = event
	const { relayer: relayer_id, commitment } = args

	logger.info(
		`Handling PostResponseHandled Event: ${stringify({
			blockNumber,
			transactionHash,
		})}`,
	)

	const chain: string = getHostStateMachine(chainId)
	const blockTimestamp = await getBlockTimestamp(blockHash, chain)

	try {
		await HyperBridgeService.handlePostRequestOrResponseHandledEvent(relayer_id, chain, blockTimestamp)

		await ResponseService.updateStatus({
			commitment,
			chain,
			blockNumber: blockNumber.toString(),
			blockTimestamp,
			blockHash: block.hash,
			status: Status.DESTINATION,
			transactionHash,
		})

		const currentIndex = event.logIndex as number
		const nextIndex = findNextIsmpEventIndex(safeArray(transaction?.logs), currentIndex, event.address)
		for (const log of safeArray(transaction?.logs)) {
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

				// Contract (target) volume via ISMP Response -> linked Request 'to'
				const response = await Response.get(commitment)
				const reqId = response?.requestId
				const req = reqId ? await Request.get(reqId) : undefined
				const contractTo = normalizeToEvmAddress(req?.to)
				if (contractTo) {
					await VolumeService.updateVolume(`Contract.${contractTo}`, amountValueInUSD, blockTimestamp)
				}
			}
		}
	} catch (error) {
		logger.error(`Error updating handling post response: ${stringify(error)}`)
	}
})
