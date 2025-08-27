import stringify from "safe-stable-stringify"
import { TokenPrice, TokenPriceLog } from "@/configs/src/types"
import { normalizeTimestamp, timestampToDate } from "@/utils/date.helpers"
import PriceHelper from "@/utils/price.helpers"
import { pick, safeArray } from "@/utils/data.helper"

import { TokenRegistryService } from "./token-registry.service"
import { TokenConfig } from "@/addresses/token-registry.addresses"

const DEFAULT_PROVIDER = "COINGECKO" as const
const DEFAULT_SUPPORTED_CURRENCY = "USD" as const

/**
 * Token Price Service fetches prices from CoinGecko adapter and stores them in the TokenPrice (current) and TokenPriceLog (historical).
 */
export class TokenPriceService {
	/**
	 * getPrice fetches the current price for a token
	 * @param symbol - The symbol of the token to fetch the price for
	 * @param currency - The currency to fetch price in (defaults to USD)
	 * @returns A Promise that resolves to the price as a number
	 */
	static async getPrice(symbol: string, currency: string = DEFAULT_SUPPORTED_CURRENCY): Promise<number> {
		const tokenPrice = await this.get(symbol, currency)
		if (!tokenPrice) {
			const response = await PriceHelper.getTokenPriceFromCoinGecko([symbol], [currency])
			if (response instanceof Error) {
				logger.error(
					`[TokenPriceService.getPrice] Failed to fetch price for new token ${symbol}: ${response.message}`,
				)
				return 0
			}

			const prices = pick(response, [symbol.toLowerCase(), symbol.toUpperCase()])
			if (prices) {
				const priceValue = pick(prices, [currency.toLowerCase() as any])
				if (priceValue && typeof priceValue === "number") {
					await this.storeTokenPrice(symbol, currency, priceValue, BigInt(Date.now()))
					return priceValue
				}
			}
			return 0
		}

		const currentTimestamp = BigInt(Date.now())

		let token = await TokenRegistryService.get(symbol)
		if (!token) {
			const tokenConfig = { name: symbol, symbol, updateFrequencySeconds: 600 } as TokenConfig
			token = await TokenRegistryService.getOrCreateToken(tokenConfig, currentTimestamp, { isActive: true })
		}

		const stale = await TokenRegistryService.isStale(token, tokenPrice.lastUpdatedAt, currentTimestamp)
		if (stale) {
			const response = await PriceHelper.getTokenPriceFromCoinGecko([symbol], [currency])
			if (response instanceof Error) {
				logger.error(
					`[TokenPriceService.getPrice] Failed to fetch fresh price for ${symbol}: ${response.message}`,
				)
				return parseFloat(tokenPrice.price)
			}

			const prices = pick(response, [symbol.toLowerCase(), symbol.toUpperCase()])
			if (prices) {
				const priceValue = pick(prices, [currency.toLowerCase() as any])
				if (priceValue && typeof priceValue === "number") {
					await this.storeTokenPrice(symbol, currency, priceValue, BigInt(Date.now()))
					return priceValue
				}
			}
		}

		return parseFloat(tokenPrice.price)
	}

	/**
	 * storeTokenPrice creates or updates a TokenPrice entity and creates a TokenPriceLog entry
	 * @param symbol - Token symbol
	 * @param price - Price value
	 * @param currency - Currency
	 * @param blockTimestamp - Block timestamp
	 * @param blockNumber - Block number (optional)
	 * @param blockHash - Block hash (optional)
	 */
	static async storeTokenPrice(
		symbol: string,
		currency: string,
		price: number,
		blockTimestamp: bigint,
	): Promise<void> {
		const id = `${symbol}-${currency}`
		const normalizedTimestamp = normalizeTimestamp(blockTimestamp)

		let tokenPrice = await this.get(symbol, currency)
		if (!tokenPrice) {
			tokenPrice = TokenPrice.create({
				id,
				symbol,
				currency,
				price: price.toString(),
				lastUpdatedAt: normalizedTimestamp,
			})

			logger.info(`[TokenPriceService.storeTokenPrice] Created new price entry: ${id}`)
		}

		tokenPrice.price = price.toString()
		tokenPrice.lastUpdatedAt = normalizedTimestamp
		logger.info(`[TokenPriceService.storeTokenPrice] Updated existing price entry: ${id}`)

		const tokenPriceLog = TokenPriceLog.create({
			id: `${id}-${blockTimestamp}`,
			symbol,
			currency,
			price: price.toString(),
			provider: DEFAULT_PROVIDER,
			timestamp: normalizedTimestamp,
			createdAt: timestampToDate(blockTimestamp),
		})

		await tokenPrice.save()
		await tokenPriceLog.save()
	}

	static async initializePriceIndexing(currentTimestamp: bigint): Promise<void> {
		await TokenRegistryService.initialize(currentTimestamp)
		await this.syncAllTokenPrices(currentTimestamp)
	}

	/**
	 * syncAllTokenPrices updates prices for all tokens that require updates
	 * @param currentTimestamp - Current timestamp
	 * @param currency - Currency to update (defaults to USD)
	 */
	static async syncAllTokenPrices(currentTimestamp: bigint, currency?: string): Promise<void> {
		const _currency = currency || DEFAULT_SUPPORTED_CURRENCY

		const symbolsNeedingUpdate: string[] = []
		const tokens = await TokenRegistryService.getActiveTokens()

		const checkResults = await Promise.all(
			tokens.map(async (token) => {
				const tokenPrice = await this.get(token.symbol, _currency)

				if (tokenPrice) {
					const isStale = await TokenRegistryService.isStale(
						token,
						tokenPrice.lastUpdatedAt,
						currentTimestamp,
					)
					return isStale ? token.symbol : null
				}

				return null
			}),
		)

		symbolsNeedingUpdate.push(...(checkResults.filter(Boolean) as string[]))

		await this.updateTokenPrices(symbolsNeedingUpdate, [_currency], currentTimestamp)
	}

	/**
	 * updateTokenPrices fetches prices from CoinGecko and stores them
	 * @param symbols - Array of token symbols to update
	 * @param currencies - Currencies to store prices (optional)
	 * @param blockTimestamp - Timestamp of the block to update prices for (optional)
	 */
	static async updateTokenPrices(symbols: string[], currencies: string[], blockTimestamp: bigint): Promise<void> {
		try {
			logger.info(`[TokenPriceService.updateTokenPrices] Syncing prices for: ${symbols}`)

			const _currencies = safeArray(currencies).length > 0 ? safeArray(currencies) : [DEFAULT_SUPPORTED_CURRENCY]

			const response = await PriceHelper.getTokenPriceFromCoinGecko(symbols, _currencies)
			if (response instanceof Error) {
				throw new Error(`Failed to fetch prices from CoinGecko: ${response.message}`)
			}

			logger.info(`[TokenPriceService.updateTokenPrices] CoinGecko response: ${stringify(response)}`)

			const storePromises = symbols.flatMap((symbol) => {
				const prices = pick(response, [symbol.toLowerCase(), symbol.toUpperCase()])
				if (!prices) return []
				return _currencies.map((currency) => {
					const priceValue = prices[currency.toLowerCase()]
					if (priceValue && typeof priceValue === "number") {
						return this.storeTokenPrice(symbol, currency, priceValue, blockTimestamp)
					}
					return Promise.resolve()
				})
			})

			await Promise.all(storePromises)
		} catch (error) {
			logger.error(`[TokenPriceService.updateTokenPrices] Failed to update prices: ${error}`)
			throw error
		}
	}

	static async get(symbol: string, currency?: string): ReturnType<typeof TokenPrice.get> {
		const _currency = currency || DEFAULT_SUPPORTED_CURRENCY
		return TokenPrice.get(`${symbol}-${_currency}`)
	}
}
