import { TOKEN_REGISTRY, TokenConfig } from "@/addresses/token-registry.addresses"
import { TokenRegistry } from "@/configs/src/types"
import { normalizeTimestamp, timestampToDate } from "@/utils/date.helpers"
import { fulfilled, safeArray } from "@/utils/data.helper"

/**
 * Token Registry Service manages token configurations and metadata,
 * providing a centralized repository for token information.
 */
export class TokenRegistryService {
	/**
	 * Initialize token registry with default tokens from TOKEN_REGISTRY
	 * @param currentTimestamp - Current timestamp
	 */
	static async initialize(currentTimestamp: bigint): Promise<void> {
	  logger.info(`[TokenRegistryService.initialize] Initializing token registry`)

		const tokensToBeIndexed = await this.getTokensToBeIndexed()
		const registrationPromises = tokensToBeIndexed.map(async (t) => this.getOrCreateToken(t, currentTimestamp))

		await Promise.allSettled(registrationPromises)
	}

	/**
	 * Register or update a token in the registry
	 * @param tokenConfig - Token configuration
	 * @param currentTimestamp - Current timestamp
	 */
	static async getOrCreateToken(config: TokenConfig, currentTimestamp: bigint): Promise<TokenRegistry> {
		const { name, symbol, updateFrequencySeconds, address } = config

		let token = await this.get(symbol)
		if (!token) {
			token = TokenRegistry.create({
				id: symbol,
				name,
				symbol,
				updateFrequencySeconds,
				address,
				lastUpdatedAt: normalizeTimestamp(currentTimestamp),
				createdAt: timestampToDate(currentTimestamp),
			})

			logger.info(`[TokenRegistryService.getOrCreateToken] Registering new token: ${symbol}`)
		}

		token.name = name
		token.address = address
		token.updateFrequencySeconds = updateFrequencySeconds
		token.lastUpdatedAt = normalizeTimestamp(currentTimestamp)
		logger.info(`[TokenRegistryService.getOrCreateToken] Updating existing token: ${symbol}`)

		await token.save()

		return token
	}

	/**
	 * Check if the token needs price update based on its update frequency
	 * @param symbol - Token symbol
	 * @param lastPriceUpdate - Token price last updated timestamp in bigint
	 * @param currentTimestamp - Current timestamp in bigint
	 * @returns Boolean indicating if token needs update
	 */
	static async isStale(token: TokenRegistry, lastPriceUpdate: bigint, currentTimestamp: bigint): Promise<boolean> {
		const timeSinceUpdateMs = Number(normalizeTimestamp(currentTimestamp)) - Number(lastPriceUpdate)
		const frequencyMs = token.updateFrequencySeconds * 1000 // Convert to milliseconds
		const needsUpdate = timeSinceUpdateMs >= frequencyMs

		logger.info(
			`[TokenRegistryService.isStale] Token ${token.symbol}: timeSinceUpdate=${timeSinceUpdateMs}ms, frequency=${frequencyMs}ms, needsUpdate=${needsUpdate}`,
		)

		return needsUpdate
	}

	/**
	 * Get all tokens (active and inactive) for a specific chain
	 * @returns Array of all TokenRegistry entities
	 */
	static async getTokens(): Promise<TokenRegistry[]> {
		const result = await Promise.allSettled(safeArray(TOKEN_REGISTRY).map((token) => this.get(token.symbol)))
		return fulfilled(result).filter((token): token is TokenRegistry => token !== undefined)
	}

	/**
	 * Get all token configurations to be indexed
	 * @returns Array of TokenConfig entities
	 */
	private static async getTokensToBeIndexed(): Promise<TokenConfig[]> {
		const tokens = await this.getTokens()
		const symbolsSet = new Set(tokens.map((token) => token.symbol.toLowerCase()))
		return safeArray(TOKEN_REGISTRY).filter((token) => !symbolsSet.has(token.symbol.toLowerCase()))
	}

	/**
	 * get fetches a token by symbol
	 * @param symbol
	 * @returns
	 */
	static async get(symbol: string): ReturnType<typeof TokenRegistry.get> {
		return TokenRegistry.get(symbol)
	}
}
