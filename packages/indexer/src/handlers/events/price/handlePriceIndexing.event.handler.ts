import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { wrap } from "@/utils/event.utils"
import { PriceFeedsService } from "@/services/priceFeeds.service"
import { SubstrateBlock } from "@subql/types"

/**
 * Handle Price Indexing for all registered tokens on a supported chain
 */
export const handlePriceIndexing = wrap(async (event: SubstrateBlock): Promise<void> => {
	try {
		const chain = getHostStateMachine(chainId)
		if (!["KUSAMA-4009", "POLKADOT-3367"].includes(chain)) return

		const {
			block: {
				header: { number, hash },
			},
		} = event

		const blockHash = hash.toHex()
		const blockNumber = number.toBigInt()

		const timestamp = await getBlockTimestamp(blockHash, chain)

		logger.info(`[handlePriceIndexing] Updating prices ${timestamp} via ${chain}`)

		await PriceFeedsService.updatePricesForChain(timestamp, BigInt(blockNumber.toString()), blockHash)

		logger.info(`Price update completed for chain: ${chain}`)
	} catch (error) {
		// @ts-ignore
		logger.error(`[handlePriceIndexing] failed ${error.message}`)
	}
})
