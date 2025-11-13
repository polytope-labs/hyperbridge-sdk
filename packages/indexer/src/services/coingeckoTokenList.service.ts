import { CoinGeckoTokenList } from "@/configs/src/types"
import { timestampToDate } from "@/utils/date.helpers"
import PriceHelper from "@/utils/price.helpers"
import stringify from "safe-stable-stringify"

const UPDATE_INTERVAL_SECONDS = 600 // 10 minutes

/**
 * Supported chains for CoinGecko token list syncing
 */
const supportedChains = ["ethereum", "polygon-pos", "base", "arbitrum-one", "binance-smart-chain"] as const

/**
 * Map chain names to their numeric chain IDs for storage
 */
const CHAIN_NAME_TO_ID: Record<string, string> = {
	ethereum: "1",
	"polygon-pos": "137",
	base: "8453",
	"arbitrum-one": "42161",
	"binance-smart-chain": "56",
}

export class CoinGeckoTokenListService {
	/**
	 * Sync CoinGecko token lists for all supported chains
	 * Only updates if 10 minutes have passed since the last update
	 * @param currentTimestamp - Current timestamp in bigint
	 */
	static async sync(currentTimestamp: bigint): Promise<void> {
		const syncPromises = supportedChains.map((chainName) => this.syncChain(chainName, currentTimestamp))

		await Promise.allSettled(syncPromises)
		logger.info(`[CoinGeckoTokenListService.sync] Completed sync for all supported chains`)
	}

	/**
	 * Sync token list for a specific chain
	 * @param chainName - Chain name (e.g., "ethereum", "polygon-pos")
	 * @param currentTimestamp - Current timestamp in bigint
	 */
	private static async syncChain(chainName: string, currentTimestamp: bigint): Promise<void> {
		const chainId = CHAIN_NAME_TO_ID[chainName] || chainName
		const existingEntity = await CoinGeckoTokenList.get(chainId)

		// Check if update is needed (10 minutes since last update)
		if (existingEntity) {
			const lastUpdateTime = existingEntity.updatedAt.getTime()
			const currentTime = timestampToDate(currentTimestamp).getTime()
			const timeSinceUpdateMs = currentTime - lastUpdateTime
			const updateIntervalMs = UPDATE_INTERVAL_SECONDS * 1000

			if (timeSinceUpdateMs < updateIntervalMs) {
				logger.info(
					`[CoinGeckoTokenListService.syncChain] Skipping sync for chain ${chainName}, only ${Math.floor(timeSinceUpdateMs / 1000)}s since last update`,
				)
				return
			}
		}

		const tokenList = await PriceHelper.getCoinGeckoTokenList(chainName)
		if (!tokenList || !tokenList.tokens || tokenList.tokens.length === 0) {
			logger.warn(`[CoinGeckoTokenListService.syncChain] No CoinGecko tokens found for chain ${chainName}`)
			return
		}

		const timestampDate = timestampToDate(currentTimestamp)
		const payload = stringify(tokenList)

		let entity = existingEntity
		if (!entity) {
			entity = CoinGeckoTokenList.create({
				id: chainId,
				chainId,
				payload,
				updatedAt: timestampDate,
				createdAt: timestampDate,
			})
		} else {
			entity.payload = payload
			entity.updatedAt = timestampDate
		}

		await entity.save()
		logger.info(`[CoinGeckoTokenListService.syncChain] Synced CoinGecko token list for chain ${chainName}`)
	}
}
