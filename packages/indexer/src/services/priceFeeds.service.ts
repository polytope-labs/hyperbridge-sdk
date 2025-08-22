import { TOKEN_REGISTRY, TokenConfig } from "@/addresses/token-registry.addresses"
import { PriceFeed, PriceFeedLog } from "@/configs/src/types"
import { safeArray } from "@/utils/data.helper"
import PriceHelper from "@/utils/price.helpers"

// CoinGecko API response interface
interface CoinGeckoResponse {
	[key: string]: {
		usd: number
	}
}

const PROVIDER_COINGECKO = "COINGECKO"

/**
 * Price Feeds Service fetches prices from CoinGecko adapter and stores them in the PriceFeed (current) and PriceFeedLog (historical).
 */
export class PriceFeedsService {
	private static lastApiCall: Map<string, number> = new Map<string, number>()
	private static minCallInterval: number = 1200 // Free tier: 50 calls/min = 1200ms between calls

	/**
	 * Main entry point: Update prices for a specific chain
	 * This is the method that indexer handlers will call
	 */
	static async updatePricesForChain(
		blockTimestamp: bigint,
		blockNumber?: bigint,
		transactionHash?: string,
	): Promise<void> {
		try {
			const tokensToUpdate = await this.getTokensRequiringUpdate(blockTimestamp)
			if (tokensToUpdate.length === 0) {
				return
			}

			const symbols = tokensToUpdate.map((token) => token.symbol.toLowerCase()).join(",")
			const response = await PriceHelper.getTokenPriceFromCoinGecko(symbols)

			if (response instanceof Error) {
				throw new Error(`Failed to fetch prices from CoinGecko: ${response.message}`)
			}

			await Promise.all(
				tokensToUpdate
					.filter((token) => !response[token.symbol.toLowerCase()].usd)
					.map(async (token) =>
						this.storePriceFeed(
							token,
							response[token.symbol.toLowerCase()].usd,
							blockTimestamp,
							blockNumber,
							transactionHash,
						),
					),
			)
		} catch {}
	}

	/**
	 * Determine which tokens need price updates based on their update frequency
	 */
	private static async getTokensRequiringUpdate(currentTimestamp: bigint): Promise<TokenConfig[]> {
		const tokensNeedingUpdate: TokenConfig[] = []
		for (const token of safeArray(TOKEN_REGISTRY)) {
			const shouldUpdate = await this.shouldUpdateTokenPrice(token, currentTimestamp)
			if (shouldUpdate) {
				tokensNeedingUpdate.push(token)
			}
		}

		return tokensNeedingUpdate
	}

	/**
	 * Check if a token price should be updated
	 */
	private static async shouldUpdateTokenPrice(token: TokenConfig, currentTimestamp: bigint): Promise<boolean> {
		const lastPrice = await PriceFeed.get(token.symbol)
		if (!lastPrice) {
			return true
		}

		const timeSinceUpdate = Number(currentTimestamp) - Number(lastPrice.lastUpdatedAt)
		return timeSinceUpdate >= token.updateFrequencySeconds
	}

	static async storePriceFeed(
		token: TokenConfig,
		price: number,
		blockTimestamp: bigint,
		blockNumber?: bigint,
		transactionHash?: string,
	) {
		let priceFeed = await PriceFeed.get(token.symbol)
		if (!priceFeed) {
			priceFeed = PriceFeed.create({
				id: token.symbol,
				symbol: token.symbol,
				price: BigInt(1) / BigInt(price),
				priceUSD: price.toString(),
				lastUpdatedAt: blockTimestamp,
			})
		}

		priceFeed.price = BigInt(1 / price)
		priceFeed.priceUSD = price.toString()
		priceFeed.lastUpdatedAt = blockTimestamp

		const priceFeedLog = PriceFeedLog.create({
			id: `${token.symbol}-${blockTimestamp}`,
			symbol: token.symbol,
			price: priceFeed.price,
			priceUSD: priceFeed.priceUSD,
			provider: PROVIDER_COINGECKO,
			timestamp: blockTimestamp,
			blockNumber: blockNumber || BigInt(0),
			transactionHash: transactionHash,
			createdAt: new Date(),
		})

		await priceFeed.save()
		await priceFeedLog.save()
	}
}
