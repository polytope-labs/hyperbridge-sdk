import { TokenList } from "@/configs/src/types"
import { timestampToDate } from "@/utils/date.helpers"
import PriceHelper, { type GeckoTerminalPool, type GeckoTerminalToken } from "@/utils/price.helpers"

const UPDATE_INTERVAL_SECONDS = 86400 // 24 hours

/**
 * Supported chains for CoinGecko OnChain token list syncing
 * Maps to CoinGecko OnChain network names
 */
const supportedChains = ["eth", "polygon_pos", "arbitrum", "base", "bsc"] as const

/**
 * Map CoinGecko OnChain network names to their numeric chain IDs for storage
 */
const NETWORK_TO_CHAIN_ID: Record<string, string> = {
	eth: "1",
	polygon_pos: "137",
	base: "8453",
	arbitrum: "42161",
	bsc: "56",
}

/**
 * Extract token address from CoinGecko OnChain token ID format (e.g., "eth_0x..." -> "0x...")
 * Handles multi-part network names like "polygon_pos_0x..." -> "0x..."
 */
function extractTokenAddress(tokenId: string): string {
	const addressMatch = tokenId.match(/0x[a-fA-F0-9]+/)
	if (addressMatch) {
		const addressIndex = tokenId.indexOf(addressMatch[0])
		return tokenId.substring(addressIndex)
	}
	// Fallback: if no 0x found, try splitting by underscore and taking the last part
	const parts = tokenId.split("_")
	return parts[parts.length - 1]
}

/**
 * Extract fee from pool name (e.g., "WETH / USDT 0.01%" -> "0.01")
 * @param poolName - Pool name
 * @returns Fee as string or empty string if not found
 */
function extractFeeFromPoolName(poolName: string): string {
	const feeMatch = poolName.match(/(\d+\.?\d*)%/)
	if (feeMatch && feeMatch[1]) {
		return feeMatch[1]
	}
	return ""
}

/**
 * Format pair information as a string: "pairAddress-TokenSymbol-protocolName-fee"
 */
function formatPairInfo(pairAddress: string, tokenSymbol: string, protocolName: string, fee: string): string {
	if (fee) {
		return `${pairAddress}-${tokenSymbol}-${protocolName}-${fee}`
	}
	return `${pairAddress}-${tokenSymbol}-${protocolName}`
}

export class CoinGeckoTokenListService {
	/**
	 * Track current page number per chain (networkName -> page number)
	 * Page numbers start at 1 and increment with each successful fetch
	 * Reset to 1 when empty response is received
	 */
	private static pageNumbers = new Map<string, number>()

	/**
	 * Get the current page number for a chain, defaulting to 1 if not set
	 * @param networkName - CoinGecko OnChain network name
	 * @returns Current page number (defaults to 1)
	 */
	private static getCurrentPage(networkName: string): number {
		return this.pageNumbers.get(networkName) || 1
	}

	/**
	 * Increment the page number for a chain
	 * @param networkName - CoinGecko OnChain network name
	 */
	private static incrementPage(networkName: string): void {
		const currentPage = this.getCurrentPage(networkName)
		this.pageNumbers.set(networkName, currentPage + 1)
	}

	/**
	 * Reset the page number to 1 for a chain
	 * @param networkName - CoinGecko OnChain network name
	 */
	private static resetPage(networkName: string): void {
		this.pageNumbers.set(networkName, 1)
	}

	/**
	 * Sync CoinGecko OnChain token lists for all supported chains
	 * Only updates if 24 hours have passed since the last update
	 * When the last page is reached (empty response), waits 24 hours before starting again from page 1
	 * @param currentTimestamp - Current timestamp in bigint
	 */
	static async sync(currentTimestamp: bigint): Promise<void> {
		const syncPromises = supportedChains.map((networkName) => this.syncChain(networkName, currentTimestamp))

		await Promise.allSettled(syncPromises)
		logger.info(`[CoinGeckoTokenListService.sync] Completed sync for all supported chains`)
	}

	/**
	 * Sync token list for a specific chain
	 * @param networkName - CoinGecko OnChain network name (e.g., "eth", "polygon_pos")
	 * @param currentTimestamp - Current timestamp in bigint
	 */
	private static async syncChain(networkName: string, currentTimestamp: bigint): Promise<void> {
		const chainId = NETWORK_TO_CHAIN_ID[networkName] || networkName

		const currentPage = this.getCurrentPage(networkName)

		if (currentPage === 1) {
			try {
				const existingTokens = await TokenList.getByChainId(chainId, {
					orderBy: "updatedAt",
					orderDirection: "DESC",
					limit: 1,
				})
				if (existingTokens && existingTokens.length > 0) {
					const lastUpdateTime = existingTokens[0].updatedAt.getTime()
					const currentTime = timestampToDate(currentTimestamp).getTime()
					const timeSinceUpdateMs = currentTime - lastUpdateTime

					if (timeSinceUpdateMs < UPDATE_INTERVAL_SECONDS * 1000) {
						logger.info(
							`[CoinGeckoTokenListService.syncChain] Skipping sync for network ${networkName} (page 1), only ${Math.floor(timeSinceUpdateMs / 1000)}s since last update. Need to wait ${Math.floor((UPDATE_INTERVAL_SECONDS * 1000 - timeSinceUpdateMs) / 1000)}s more.`,
						)
						return
					}
				}
			} catch (error) {
				logger.debug(`[CoinGeckoTokenListService.syncChain] Could not check last update time: ${error}`)
			}
		}
		let pools: GeckoTerminalPool[] = []
		let tokensMap: Map<string, GeckoTerminalToken> = new Map()

		try {
			const result = await PriceHelper.getGeckoTerminalPools(networkName, currentPage)
			pools = result.pools
			tokensMap = result.tokens

			if (!pools || pools.length === 0) {
				this.resetPage(networkName)

				const timestampDate = timestampToDate(currentTimestamp)
				try {
					const existingTokens = await TokenList.getByChainId(chainId, {
						orderBy: "updatedAt",
						orderDirection: "DESC",
						limit: 1,
					})
					if (existingTokens && existingTokens.length > 0) {
						existingTokens[0].updatedAt = timestampDate
						await existingTokens[0].save()
					}
				} catch (error) {
					logger.debug(
						`[CoinGeckoTokenListService.syncChain] Could not update timestamp after empty response: ${error}`,
					)
				}

				logger.info(
					`[CoinGeckoTokenListService.syncChain] Empty response for page ${currentPage} on ${networkName}, resetting to page 1. Will wait 24 hours before starting again.`,
				)
				return
			}

			this.incrementPage(networkName)
			logger.info(
				`[CoinGeckoTokenListService.syncChain] Fetched page ${currentPage} for ${networkName}: ${pools.length} pools. Next page will be ${this.getCurrentPage(networkName)}`,
			)
		} catch (error) {
			logger.error(
				`[CoinGeckoTokenListService.syncChain] Error fetching page ${currentPage} for ${networkName}: ${error}`,
			)
			// On error, reset to page 1 to avoid getting stuck
			this.resetPage(networkName)
			return
		}

		const allPools = pools

		const tokenMap = new Map<
			string,
			{ tokenName: string; tokenSymbol: string; tokenURI: string | null; pairedWith: Set<string> }
		>()

		const ensureTokenInMap = (tokenAddress: string): void => {
			if (!tokenMap.has(tokenAddress)) {
				const normalizedAddress = tokenAddress.toLowerCase()
				const token = tokensMap.get(normalizedAddress)

				if (!token) {
					logger.warn(
						`[CoinGeckoTokenListService.syncChain] Token not found in included array for address: ${tokenAddress}`,
					)
					return
				}

				tokenMap.set(tokenAddress, {
					tokenName: token.attributes.name,
					tokenSymbol: token.attributes.symbol,
					tokenURI: token.attributes.image_url || null,
					pairedWith: new Set(),
				})
			}
		}

		for (const pool of allPools) {
			const pairAddress = pool.attributes.address
			const poolName = pool.attributes.name
			const protocolName = pool.relationships.dex?.data?.id || "unknown"
			const fee = extractFeeFromPoolName(poolName)

			const allTokensInPool: string[] = []
			const seenAddresses = new Set<string>()

			if (pool.relationships.base_token?.data) {
				const baseTokenAddress = extractTokenAddress(pool.relationships.base_token.data.id)
				if (!seenAddresses.has(baseTokenAddress)) {
					allTokensInPool.push(baseTokenAddress)
					seenAddresses.add(baseTokenAddress)
				}
			}

			if (pool.relationships.quote_token?.data) {
				const quoteTokenAddress = extractTokenAddress(pool.relationships.quote_token.data.id)
				if (!seenAddresses.has(quoteTokenAddress)) {
					allTokensInPool.push(quoteTokenAddress)
					seenAddresses.add(quoteTokenAddress)
				}
			}

			if (pool.relationships.quote_tokens?.data) {
				for (const quoteToken of pool.relationships.quote_tokens.data) {
					const quoteTokenAddress = extractTokenAddress(quoteToken.id)
					if (!seenAddresses.has(quoteTokenAddress)) {
						allTokensInPool.push(quoteTokenAddress)
						seenAddresses.add(quoteTokenAddress)
					}
				}
			}

			for (const tokenAddress of allTokensInPool) {
				ensureTokenInMap(tokenAddress)
				const tokenData = tokenMap.get(tokenAddress)

				if (!tokenData) {
					continue
				}

				for (const otherTokenAddress of allTokensInPool) {
					if (otherTokenAddress !== tokenAddress) {
						ensureTokenInMap(otherTokenAddress)

						const otherTokenData = tokenMap.get(otherTokenAddress)
						if (otherTokenData) {
							const pairInfoString = formatPairInfo(
								pairAddress,
								otherTokenData.tokenSymbol,
								protocolName,
								fee,
							)
							tokenData.pairedWith.add(pairInfoString)
						}
					}
				}
			}
		}

		const timestampDate = timestampToDate(currentTimestamp)
		let savedCount = 0
		let errorCount = 0

		for (const [tokenAddress, tokenData] of tokenMap.entries()) {
			const tokenId = `${tokenAddress}-${chainId}`

			try {
				const pairedWithArray = Array.from(tokenData.pairedWith)

				const existingEntity = await TokenList.get(tokenId)

				if (existingEntity) {
					existingEntity.tokenName = tokenData.tokenName
					existingEntity.tokenSymbol = tokenData.tokenSymbol
					existingEntity.tokenURI = tokenData.tokenURI || undefined
					existingEntity.pairedWith = pairedWithArray
					existingEntity.updatedAt = timestampDate
					await existingEntity.save()
					savedCount++
				} else {
					const newEntity = TokenList.create({
						id: tokenId,
						tokenAddress,
						chainId,
						tokenName: tokenData.tokenName,
						tokenSymbol: tokenData.tokenSymbol,
						tokenURI: tokenData.tokenURI || undefined,
						pairedWith: pairedWithArray,
						updatedAt: timestampDate,
						createdAt: timestampDate,
					})
					await newEntity.save()
					savedCount++
				}
			} catch (error) {
				errorCount++
				logger.error(`[CoinGeckoTokenListService.syncChain] Error saving token ${tokenAddress}: ${error}`)
			}
		}

		logger.info(
			`[CoinGeckoTokenListService.syncChain] Synced ${savedCount} tokens (${errorCount} errors) for network ${networkName} (chainId: ${chainId}) from ${allPools.length} pools`,
		)
	}
}
