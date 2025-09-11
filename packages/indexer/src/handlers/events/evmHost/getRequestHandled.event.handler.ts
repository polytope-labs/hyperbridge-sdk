import { HyperBridgeService } from "@/services/hyperbridge.service"
import { Status, Transfer } from "@/configs/src/types"
import { GetRequestHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { GetRequestService } from "@/services/getRequest.service"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { wrap } from "@/utils/event.utils"
import { getPriceDataFromEthereumLog, isERC20TransferEvent, extractAddressFromTopic } from "@/utils/transfer.helpers"
import { TransferService } from "@/services/transfer.service"
import { VolumeService } from "@/services/volume.service"
import { safeArray } from "@/utils/data.helper"
import { decodeFunctionData, Hex } from "viem"
import HandlerV1Abi from "@/configs/abis/HandlerV1.abi.json"
import { IGetResponse } from "@/types/ismp"

/**
 * Handles the GetRequestHandled event from EVMHost
 */
export const handleGetRequestHandledEvent = wrap(async (event: GetRequestHandledLog): Promise<void> => {
	if (!event.args) return

	const { args, block, transaction, transactionHash, blockNumber, blockHash } = event

	const { relayer: relayer_id, commitment } = args

	logger.info(
		`Handling GetRequestHandled Event: ${stringify({
			blockNumber,
			transactionHash,
		})}`,
	)

	const chain = getHostStateMachine(chainId)
	const blockTimestamp = await getBlockTimestamp(blockHash, chain)

	try {
		await HyperBridgeService.handlePostRequestOrResponseHandledEvent(relayer_id, chain, blockTimestamp)

		await GetRequestService.updateStatus({
			commitment,
			chain,
			blockNumber: blockNumber.toString(),
			blockHash: block.hash,
			blockTimestamp,
			status: Status.DESTINATION,
			transactionHash,
		})

		let fromAddresses = [] as Hex[]

		if (transaction?.input) {
			const { functionName, args } = decodeFunctionData({
				abi: HandlerV1Abi,
				data: transaction.input as Hex,
			})

			if (functionName === "handleGetResponses" && args && args.length > 0) {
				const getResponses = args[1] as IGetResponse[] // Second argument is the array of get responses
				for (const getResponse of getResponses) {
					const { get } = getResponse
					const { from: getRequestFrom } = get
					fromAddresses.push(getRequestFrom)
				}
			}
		}

		for (const [index, log] of safeArray(transaction?.logs).entries()) {
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
					transactionHash: `${log.transactionHash}-index-${index}`,
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

				if (fromAddresses.some((address) => address.toLowerCase() === from.toLowerCase())) {
					await VolumeService.updateVolume(`Contract.${from}`, amountValueInUSD, blockTimestamp)
				}
			}
		}
	} catch (error) {
		logger.error(`Error handling GetRequestHandled Event: ${error}`)
	}
})
