import stringify from "safe-stable-stringify"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { wrap } from "@/utils/event.utils"
import { TransferLog } from "@/configs/src/types/abi-interfaces/ERC6160Ext20Abi"
import { PriceFeedsService } from "@/services/priceFeeds.service"

/**
 * Handle Price Indexing for all registered tokens on a chain when significant events occur
 */
export const handlePriceIndexing = wrap(async (transfer: TransferLog): Promise<void> => {
	try {
		logger.info(`[handlePriceIndexing] Event triggered: ${stringify(transfer)}`)

		const { blockNumber, block, transactionHash } = transfer
		const chain = getHostStateMachine(chainId)
		const timestamp = await getBlockTimestamp(block.hash, chain)

		logger.info(`[handlePriceIndexing] Updating prices ${timestamp} via ${chain}`)

		// Update prices for this chain
		await PriceFeedsService.updatePricesForChain(timestamp, BigInt(blockNumber.toString()), transactionHash)

		logger.info(`Price update completed for chain: ${chain}`)
	} catch (error) {
		logger.error(`[handlePriceIndexing] failed ${stringify(error)}`)
	}
})
