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
	static async getPrice(
		symbol: string,
		currentTimestamp = BigInt(Date.now()),
		currency: string = DEFAULT_SUPPORTED_CURRENCY,
	): Promise<number> {
		let token = await TokenRegistryService.get(symbol)
		if (!token) {
			const tokenConfig = { name: symbol, symbol, updateFrequencySeconds: 600 } as TokenConfig
			token = await TokenRegistryService.getOrCreateToken(tokenConfig, currentTimestamp, { isActive: true })
		}

		let tokenPrice = await this.get(symbol, currency)
		if (!tokenPrice) {
			const updatedTokenPrices = await this.updateTokenPrices([symbol], [currency], currentTimestamp)
			if (updatedTokenPrices.length === 0) throw new Error(`Failed to update token price for ${symbol}`)
			tokenPrice = updatedTokenPrices[0]
		}

		const stale = await TokenRegistryService.isStale(token, tokenPrice.lastUpdatedAt, currentTimestamp)
		if (!stale) return parseFloat(tokenPrice.price)

		const updatedTokenPrices = await this.updateTokenPrices([symbol], [currency], currentTimestamp)
		if (updatedTokenPrices.length === 0) throw new Error(`Failed to update token price for ${symbol}`)
		tokenPrice = updatedTokenPrices[0]

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
	): Promise<TokenPrice> {
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

		return tokenPrice
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
	static async updateTokenPrices(
		symbols: string[],
		currencies: string[],
		blockTimestamp: bigint,
	): Promise<TokenPrice[]> {
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

			return _currencies.map((currency) =>
				this.storeTokenPrice(symbol, currency, prices[currency.toLowerCase()], blockTimestamp),
			)
		})

		return Promise.all(storePromises)
	}

	static async get(symbol: string, currency?: string): ReturnType<typeof TokenPrice.get> {
		const _currency = currency || DEFAULT_SUPPORTED_CURRENCY
		return TokenPrice.get(`${symbol}-${_currency}`)
	}
}
