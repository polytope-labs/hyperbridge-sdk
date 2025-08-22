import { TOKEN_REGISTRY, TokenConfig } from "@/addresses/token-registry.addresses"
import { PriceFeed, PriceFeedLog } from "@/configs/src/types"
import { safeArray } from "@/utils/data.helper"
import PriceHelper, { PriceResponse } from "@/utils/price.helpers"

const PROVIDER_COINGECKO = "COINGECKO"

/**
 * Price Feeds Service fetches prices from CoinGecko adapter and stores them in the PriceFeed (current) and PriceFeedLog (historical).
 */
export class PriceFeedsService {

  static async getPrice(symbol: string, amount: bigint, decimals: number): Promise<PriceResponse> {
    const token = TOKEN_REGISTRY.find(token => token.symbol === symbol)
    if (!token) return {  priceInUSD: '0', amountValueInUSD: '0' }

    const priceFeed = await PriceFeed.get(symbol)
    const expired = await this.shouldUpdateTokenPrice(token, BigInt(Date.now()))

    if (!priceFeed || expired) {
      const response = await PriceHelper.getTokenPriceFromCoinGecko(symbol)
      if (response instanceof Error) {
        return { priceInUSD: '0', amountValueInUSD: '0' }
      }

      this.updatePricesForChain(BigInt(Date.now())).catch(error =>
        console.error('Background price update failed:', error)
      )

      const price = response[symbol.toLowerCase()]?.usd
      if (!price || price <= 0) {
        return { priceInUSD: '0', amountValueInUSD: '0' }
      }

      return PriceHelper.getAmountValueInUSD(amount, decimals, price.toString())
    }

    return PriceHelper.getAmountValueInUSD(amount, decimals, priceFeed.priceUSD)
  }

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
					.filter((token) => response[token.symbol.toLowerCase()]?.usd > 0)
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
		} catch (error) {
			logger.error(`Failed to update prices for chain: ${error}`)
		}
	}

	/**
	 * Determine which tokens need price updates based on their update frequency
	 */
	static async getTokensRequiringUpdate(currentTimestamp: bigint): Promise<TokenConfig[]> {
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
	static async shouldUpdateTokenPrice(token: TokenConfig, currentTimestamp: bigint): Promise<boolean> {
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
				priceUSD: price.toString(),
				lastUpdatedAt: blockTimestamp,
			})
		}

		priceFeed.priceUSD = price.toString()
		priceFeed.lastUpdatedAt = blockTimestamp

		const priceFeedLog = PriceFeedLog.create({
			id: `${token.symbol}-${blockTimestamp}`,
			symbol: token.symbol,
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
