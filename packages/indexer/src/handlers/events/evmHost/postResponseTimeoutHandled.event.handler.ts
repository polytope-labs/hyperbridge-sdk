import { Status } from "@/configs/src/types"
import { PostResponseTimeoutHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { HyperBridgeService } from "@/services/hyperbridge.service"
import { ResponseService } from "@/services/response.service"
import { wrap } from "@/utils/event.utils"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import stringify from "safe-stable-stringify"
import { Transfer } from "@/configs/src/types"
import { VolumeService } from "@/services/volume.service"
import { getPriceDataFromEthereumLog, isERC20TransferEvent, extractAddressFromTopic } from "@/utils/transfer.helpers"
import { TransferService } from "@/services/transfer.service"
import { safeArray } from "@/utils/data.helper"
import { IPostResponse } from "@/types/ismp"
import { decodeFunctionData, Hex } from "viem"
import EthereumHostAbi from "@/configs/abis/EthereumHost.abi.json"

/**
 * Handles the PostResponseTimeoutHandled event
 */
export const handlePostResponseTimeoutHandledEvent = wrap(
	async (event: PostResponseTimeoutHandledLog): Promise<void> => {
		if (!event.args) return
		const { args, block, transaction, transactionHash, transactionIndex, blockHash, blockNumber, data } = event
		const { commitment, dest } = args

		logger.info(
			`Handling PostResponseTimeoutHandled Event: ${stringify({
				blockNumber,
				transactionHash,
			})}`,
		)

		const chain: string = getHostStateMachine(chainId)
		const blockTimestamp = await getBlockTimestamp(blockHash, chain)

		try {
			await HyperBridgeService.incrementNumberOfTimedOutMessagesSent(chain)

			await ResponseService.updateStatus({
				commitment,
				chain,
				blockNumber: blockNumber.toString(),
				blockHash: block.hash,
				blockTimestamp,
				status: Status.TIMED_OUT,
				transactionHash,
			})

			for (const log of safeArray(transaction?.logs)) {
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

					if (transaction?.input) {
						const { functionName, args } = decodeFunctionData({
							abi: EthereumHostAbi,
							data: transaction.input as Hex,
						})

						const {
							post: { from: postRequestFrom, to: postRequestTo },
						} = args![0] as unknown as IPostResponse

						await VolumeService.updateVolume(
							`Contract.${postRequestFrom}`,
							amountValueInUSD,
							blockTimestamp,
						)

						await VolumeService.updateVolume(`Contract.${postRequestTo}`, amountValueInUSD, blockTimestamp)
					}
				}
			}
		} catch (error) {
			logger.error(`Error updating handling post response timeout: ${stringify(error)}`)
		}
	},
)
