import { TokenList } from "@/configs/src/types"
import { timestampToDate } from "@/utils/date.helpers"
import PriceHelper, { type GeckoTerminalPool } from "@/utils/price.helpers"

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
 */
function extractTokenAddress(tokenId: string): string {
	const parts = tokenId.split("_")
	if (parts.length >= 2) {
		return parts.slice(1).join("_") // Handle cases where address might have underscores
	}
	return tokenId
}

/**
 * Extract token name from pool name
 * @param poolName - Pool name (e.g., "WETH / USDT 0.01%")
 * @param tokenAddress - Token address to identify which token in the pair
 * @param isBaseToken - Whether this is the base token (true) or quote token (false)
 * @returns Token name extracted from pool name
 */
function extractTokenNameFromPoolName(poolName: string, tokenAddress: string, isBaseToken: boolean = true): string {
	// Try to extract from pool name (format: "TOKEN1 / TOKEN2 ..." or "TOKEN1 / TOKEN2 / TOKEN3")
	const parts = poolName.split(" / ")

	// Determine which part to use based on whether it's base or quote token
	// For base token, use first part; for quote token, use second part (if available)
	let namePart: string | undefined
	if (isBaseToken && parts.length > 0) {
		namePart = parts[0]
	} else if (!isBaseToken && parts.length > 1) {
		namePart = parts[1]
	} else if (parts.length > 0) {
		// Fallback to first part if we can't determine
		namePart = parts[0]
	}

	if (namePart) {
		// Remove fee tier info if present (e.g., "0.01%", "0.05%")
		const name = namePart.trim().replace(/\s+\d+\.?\d*%$/, "")
		if (name) {
			return name
		}
	}

	// Fallback: return a generic name based on address
	return `Token ${tokenAddress.slice(0, 8)}...`
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
 * Format pair information as a string: "pairAddress-TokenName-protocolName-fee"
 */
function formatPairInfo(pairAddress: string, tokenName: string, protocolName: string, fee: string): string {
	if (fee) {
		return `${pairAddress}-${tokenName}-${protocolName}-${fee}`
	}
	return `${pairAddress}-${tokenName}-${protocolName}`
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

		try {
			pools = await PriceHelper.getGeckoTerminalPools(networkName, currentPage)

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

		const tokenMap = new Map<string, { tokenName: string; pairedWith: Set<string> }>()
		const tokenNameMap = new Map<string, string>()

		const ensureTokenInMap = (tokenAddress: string, tokenName: string): void => {
			if (!tokenMap.has(tokenAddress)) {
				tokenMap.set(tokenAddress, {
					tokenName,
					pairedWith: new Set(),
				})
			} else {
				const existingData = tokenMap.get(tokenAddress)!
				// Update token name if we have a better one (not a fallback name)
				if (!existingData.tokenName.startsWith("Token ") && tokenName.startsWith("Token ")) {
					tokenName = existingData.tokenName
				} else if (tokenName && !tokenName.startsWith("Token ")) {
					existingData.tokenName = tokenName
				}
			}
			// Update tokenNameMap for quick lookup
			if (tokenName && !tokenName.startsWith("Token ")) {
				tokenNameMap.set(tokenAddress, tokenName)
			} else if (!tokenNameMap.has(tokenAddress)) {
				tokenNameMap.set(tokenAddress, tokenName)
			}
		}

		const getTokenName = (
			tokenAddress: string,
			poolName: string,
			isBaseToken: boolean,
			poolNameParts?: string[],
			partIndex?: number,
		): string => {
			if (tokenNameMap.has(tokenAddress)) {
				const existingName = tokenNameMap.get(tokenAddress)!
				if (!existingName.startsWith("Token ")) {
					return existingName
				}
			}

			if (poolNameParts && partIndex !== undefined && partIndex < poolNameParts.length) {
				const name = poolNameParts[partIndex].trim().replace(/\s+\d+\.?\d*%$/, "")
				if (name) {
					return name
				}
			}

			return extractTokenNameFromPoolName(poolName, tokenAddress, isBaseToken)
		}

		for (const pool of allPools) {
			const pairAddress = pool.attributes.address
			const poolName = pool.attributes.name
			const protocolName = pool.relationships.dex?.data?.id || "unknown"
			const fee = extractFeeFromPoolName(poolName)
			const poolNameParts = poolName.split(" / ")

			const allTokensInPool: Array<{ address: string; isBase: boolean; partIndex: number }> = []
			const seenAddresses = new Set<string>()

			if (pool.relationships.base_token?.data) {
				const baseTokenAddress = extractTokenAddress(pool.relationships.base_token.data.id)
				if (!seenAddresses.has(baseTokenAddress)) {
					allTokensInPool.push({ address: baseTokenAddress, isBase: true, partIndex: 0 })
					seenAddresses.add(baseTokenAddress)
				}
			}

			if (pool.relationships.quote_token?.data) {
				const quoteTokenAddress = extractTokenAddress(pool.relationships.quote_token.data.id)
				if (!seenAddresses.has(quoteTokenAddress)) {
					allTokensInPool.push({ address: quoteTokenAddress, isBase: false, partIndex: 1 })
					seenAddresses.add(quoteTokenAddress)
				}
			}

			if (pool.relationships.quote_tokens?.data) {
				let partIndex = 1
				for (const quoteToken of pool.relationships.quote_tokens.data) {
					const quoteTokenAddress = extractTokenAddress(quoteToken.id)
					if (!seenAddresses.has(quoteTokenAddress)) {
						allTokensInPool.push({ address: quoteTokenAddress, isBase: false, partIndex })
						seenAddresses.add(quoteTokenAddress)
						partIndex++
					}
				}
			}

			for (const tokenInfo of allTokensInPool) {
				const tokenAddress = tokenInfo.address
				const tokenName = getTokenName(
					tokenAddress,
					poolName,
					tokenInfo.isBase,
					poolNameParts,
					tokenInfo.partIndex,
				)

				ensureTokenInMap(tokenAddress, tokenName)
				const tokenData = tokenMap.get(tokenAddress)!

				for (const otherTokenInfo of allTokensInPool) {
					if (otherTokenInfo.address !== tokenAddress) {
						const otherTokenAddress = otherTokenInfo.address
						const otherTokenName = getTokenName(
							otherTokenAddress,
							poolName,
							otherTokenInfo.isBase,
							poolNameParts,
							otherTokenInfo.partIndex,
						)
						ensureTokenInMap(otherTokenAddress, otherTokenName)

						const pairInfoString = formatPairInfo(pairAddress, otherTokenName, protocolName, fee)
						tokenData.pairedWith.add(pairInfoString)
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
