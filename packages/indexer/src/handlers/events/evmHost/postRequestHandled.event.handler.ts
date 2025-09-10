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
import { decodeFunctionData, Hex } from "viem"
import HandlerV1Abi from "@/configs/abis/HandlerV1.abi.json"
import { IPostRequest } from "@/types/ismp"

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

		let fromAddresses = [] as Hex[]
		let toAddresses = [] as Hex[]

		if (transaction?.input) {
			const { functionName, args } = decodeFunctionData({
				abi: HandlerV1Abi,
				data: transaction.input as Hex,
			})

			if (functionName === "handlePostRequests" && args && args.length > 0) {
				const postRequests = args[1] as IPostRequest[] // Second argument is the array of post requests
				for (const postRequest of postRequests) {
					const { from: postRequestFrom, to: postRequestTo } = postRequest
					fromAddresses.push(postRequestFrom)
					toAddresses.push(postRequestTo)
				}
			}
		}

		for (const log of safeArray(transaction.logs)) {
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

				for (const fromAddress of fromAddresses) {
					if (
						fromAddress.toLowerCase() === from.toLowerCase() ||
						fromAddress.toLowerCase() === to.toLowerCase()
					) {
						await VolumeService.updateVolume(`Contract.${fromAddress}`, amountValueInUSD, blockTimestamp)
					}
				}

				for (const toAddress of toAddresses) {
					if (
						toAddress.toLowerCase() === from.toLowerCase() ||
						toAddress.toLowerCase() === to.toLowerCase()
					) {
						await VolumeService.updateVolume(`Contract.${toAddress}`, amountValueInUSD, blockTimestamp)
					}
				}
			}
		}
	} catch (error) {
		console.error(`Error handling PostRequestHandled event: ${stringify(error)}`)
	}
})
