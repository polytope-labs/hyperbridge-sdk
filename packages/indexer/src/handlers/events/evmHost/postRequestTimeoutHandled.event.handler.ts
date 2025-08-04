import { Status } from "@/configs/src/types"
import { PostRequestTimeoutHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { HyperBridgeService } from "@/services/hyperbridge.service"
import { RequestService } from "@/services/request.service"
import { wrap } from "@/utils/event.utils"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import stringify from "safe-stable-stringify"
import { ERC6160Ext20Abi__factory } from "@/configs/src/types/contracts"
import PriceHelper from "@/utils/price.helpers"
import { VolumeService } from "@/services/volume.service"

/**
 * Handles the PostRequestTimeoutHandled event
 */
export const handlePostRequestTimeoutHandledEvent = wrap(async (event: PostRequestTimeoutHandledLog): Promise<void> => {
	if (!event.args) return

	const { args, block, transaction, transactionHash, transactionIndex, blockHash, blockNumber, data } = event
	const { commitment, dest } = args

	logger.info(
		`Handling PostRequestTimeoutHandled Event: ${stringify({
			blockNumber,
			transactionHash,
		})}`,
	)

	const chain: string = getHostStateMachine(chainId)
	const blockTimestamp = await getBlockTimestamp(blockHash, chain)

	try {
		await HyperBridgeService.incrementNumberOfTimedOutMessagesSent(chain)

		await RequestService.updateStatus({
			commitment,
			chain,
			blockNumber: blockNumber.toString(),
			blockHash: block.hash,
			blockTimestamp,
			status: Status.TIMED_OUT,
			transactionHash,
		})

		if (transaction &&  transaction.logs) {
			for (const log of transaction.logs) {
			  // check if the topic includes Transfer(address, address, uint256)
			  if (!log.topics.includes("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")) {
					continue
				}

			  const contract = ERC6160Ext20Abi__factory.connect(log.address, api)

				const amount = BigInt(log.data)
				const symbol = await contract.symbol()
				const decimals = await contract.decimals()

				const price = await PriceHelper.getTokenPriceInUSDCoingecko(symbol, amount, decimals)

				await VolumeService.updateVolume(`Transfer.${symbol}`, price.amountValueInUSD, blockTimestamp)
			}
		}
	} catch (error) {
		logger.error(`Error updating handling post request timeout: ${stringify(error)}`)
	}
})
