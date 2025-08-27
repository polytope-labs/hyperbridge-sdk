import { TOKEN_REGISTRY, TokenConfig } from "@/addresses/token-registry.addresses"
import { TokenRegistry } from "@/configs/src/types"
import { normalizeTimestamp, timestampToDate } from "@/utils/date.helpers"
import { safeArray } from "@/utils/data.helper"

/**
 * Token Registry Service manages token configurations and metadata,
 * providing a centralized repository for token information.
 */
export class TokenRegistryService {
	/**
	 * Initialize token registry with default tokens from TOKEN_REGISTRY
	 * @param forceUpdate - Whether to update existing tokens
	 */
	static async initialize(currentTimestamp: bigint, forceUpdate = false): Promise<void> {
		logger.info(`[TokenRegistryService.initialize] Initializing token registry`)

		const registrationPromises = safeArray(TOKEN_REGISTRY).map(async (t) => {
			const supported = await this.isTokenSupported(t.symbol)

			if (!supported || forceUpdate) {
				await this.getOrCreateToken(t, currentTimestamp, { isActive: true })
			}
		})

		await Promise.all(registrationPromises)
		logger.info(`[TokenRegistryService.initialize] Initialized ${TOKEN_REGISTRY.length} tokens`)
	}

	/**
	 * Register or update a token in the registry
	 * @param tokenConfig - Token configuration
	 * @param currentTimestamp - Current timestamp
	 * @param options - Additional options for registration
	 */
	static async getOrCreateToken(
		config: TokenConfig,
		currentTimestamp: bigint,
		options: { isActive?: boolean } = {},
	): Promise<TokenRegistry> {
		const { name, symbol, updateFrequencySeconds, address } = config

		let token = await this.get(symbol)
		if (!token) {
			token = TokenRegistry.create({
				id: symbol,
				name,
				symbol,
				updateFrequencySeconds,
				address,
				isActive: options?.isActive ?? true,
				lastUpdatedAt: normalizeTimestamp(currentTimestamp),
				createdAt: timestampToDate(currentTimestamp),
			})

			logger.info(`[TokenRegistryService.getOrCreateToken] Registering new token: ${symbol}`)
		}

		token.name = name
		token.address = address
		token.updateFrequencySeconds = updateFrequencySeconds
		token.isActive = options?.isActive ?? token.isActive
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
	 * Get all active tokens from the token registry
	 * @returns Array of active TokenRegistry entities
	 */
	static async getActiveTokens(): Promise<TokenRegistry[]> {
		const tokens = await this.getTokens()
		return tokens.filter((token) => token.isActive)
	}

	/**
	 * Get all tokens (active and inactive) for a specific chain
	 * @returns Array of all TokenRegistry entities
	 */
	private static async getTokens(): Promise<TokenRegistry[]> {
		const tokens = await Promise.all(safeArray(TOKEN_REGISTRY).map((token) => this.get(token.symbol)))
		return tokens.filter((token): token is TokenRegistry => token !== undefined)
	}

	/**
	 * isTokenSupported checks if a token is supported (exists and is active)
	 * @param symbol - Token symbol
	 * @returns Boolean indicating if token is supported
	 */
	private static async isTokenSupported(symbol: string): Promise<boolean> {
		const token = await this.get(symbol)
		return token !== undefined && token.isActive
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
