import { HyperBridgeService } from "@/services/hyperbridge.service"
import { Status } from "@/configs/src/types"
import { PostRequestHandledLog } from "@/configs/src/types/abi-interfaces/EthereumHostAbi"
import { RequestService } from "@/services/request.service"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { wrap } from "@/utils/event.utils"
import { ERC6160Ext20Abi__factory } from "@/configs/src/types/contracts"
import PriceHelper from "@/utils/price.helpers"
import { VolumeService } from "@/services/volume.service"

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
		console.error(`Error handling PostRequestHandled event: ${stringify(error)}`)
	}
})
