import Decimal from "decimal.js"
import { ERC6160Ext20Abi__factory } from "@/configs/src/types/contracts"
import { DustCollected } from "@/configs/src/types/models/DustCollected"
import { DustSwept } from "@/configs/src/types/models/DustSwept"
import { ProtocolRevenue } from "@/configs/src/types/models/ProtocolRevenue"
import { timestampToDate } from "@/utils/date.helpers"
import PriceHelper from "@/utils/price.helpers"
import { TokenPriceService } from "./token-price.service"
import stringify from "safe-stable-stringify"

export class ProtocolRevenueService {
	/**
	 * Get or create a DustCollected record
	 */
	static async recordDustCollected(tokenAddress: string, amount: bigint, timestamp: bigint): Promise<DustCollected> {
		const id = `${chainId}-${tokenAddress.toLowerCase()}`
		let symbol = "eth"

		// Get token symbol if not native token
		if (tokenAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
			try {
				const tokenContract = ERC6160Ext20Abi__factory.connect(tokenAddress, api)
				symbol = await tokenContract.symbol()
			} catch (error) {
				logger.warn(
					`Failed to get symbol for token ${tokenAddress}: ${stringify({
						error: error as unknown as Error,
					})}`,
				)
				symbol = "UNKNOWN"
			}
		}

		let dustCollected = await DustCollected.get(id)

		if (!dustCollected) {
			dustCollected = await DustCollected.create({
				id,
				tokenSymbol: symbol,
				amount,
				lastUpdated: timestampToDate(timestamp),
			})
		} else {
			dustCollected.amount = dustCollected.amount + amount
			dustCollected.lastUpdated = timestampToDate(timestamp)
		}

		await dustCollected.save()

		// Calculate USD value and update ProtocolRevenue
		await this.updateProtocolRevenueAccrued(tokenAddress, amount, symbol, timestamp)

		logger.info(
			`DustCollected recorded: ${stringify({
				id,
				tokenSymbol: symbol,
				amount: dustCollected.amount.toString(),
			})}`,
		)

		return dustCollected
	}

	/**
	 * Get or create a DustSwept record
	 */
	static async recordDustSwept(tokenAddress: string, amount: bigint, timestamp: bigint): Promise<DustSwept> {
		const id = `${chainId}-${tokenAddress.toLowerCase()}`
		let symbol = "eth"

		// Get token symbol if not native token
		if (tokenAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
			try {
				const tokenContract = ERC6160Ext20Abi__factory.connect(tokenAddress, api)
				symbol = await tokenContract.symbol()
			} catch (error) {
				logger.warn(
					`Failed to get symbol for token ${tokenAddress}: ${stringify({
						error: error as unknown as Error,
					})}`,
				)
				symbol = "UNKNOWN"
			}
		}

		let dustSwept = await DustSwept.get(id)

		if (!dustSwept) {
			dustSwept = await DustSwept.create({
				id,
				tokenSymbol: symbol,
				amount,
				lastUpdated: timestampToDate(timestamp),
			})
		} else {
			dustSwept.amount = dustSwept.amount + amount
			dustSwept.lastUpdated = timestampToDate(timestamp)
		}

		await dustSwept.save()

		// Calculate USD value and update ProtocolRevenue
		await this.updateProtocolRevenueWithdrawn(tokenAddress, amount, symbol, timestamp)

		logger.info(
			`DustSwept recorded: ${stringify({
				id,
				tokenSymbol: symbol,
				amount: dustSwept.amount.toString(),
			})}`,
		)

		return dustSwept
	}

	/**
	 * Update ProtocolRevenue accrued amount
	 */
	private static async updateProtocolRevenueAccrued(
		tokenAddress: string,
		amount: bigint,
		symbol: string,
		timestamp: bigint,
	): Promise<void> {
		try {
			let decimals = 18

			if (tokenAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
				try {
					const tokenContract = ERC6160Ext20Abi__factory.connect(tokenAddress, api)
					decimals = await tokenContract.decimals()
				} catch (error) {
					logger.warn(
						`Failed to get decimals for token ${tokenAddress}: ${stringify({
							error: error as unknown as Error,
						})}`,
					)
				}
			}

			// Try to get price from TokenPriceService (whitelisted tokens)
			let price = await TokenPriceService.getPrice(symbol, timestamp)
			let amountValueInUSD: string

			// If price is 0 (non-whitelisted or unavailable), try CoinGecko directly as fallback
			if (price === 0) {
				logger.info(
					`Token ${symbol} not whitelisted or price unavailable, attempting CoinGecko fallback for ${tokenAddress}`,
				)
				try {
					const coingeckoResponse = await PriceHelper.getTokenPriceFromCoinGecko(symbol)
					if (coingeckoResponse instanceof Error) {
						logger.warn(
							`Failed to get CoinGecko price for ${symbol} (${tokenAddress}): ${stringify({
								error: coingeckoResponse,
							})}. Revenue tracking skipped for this dust.`,
						)
						amountValueInUSD = "0"
					} else {
						const priceData =
							coingeckoResponse[symbol.toLowerCase()] || coingeckoResponse[symbol.toUpperCase()]
						if (priceData?.usd) {
							price = priceData.usd
							const priceResponse = PriceHelper.getAmountValueInUSD(amount, decimals, price)
							amountValueInUSD = priceResponse.amountValueInUSD
							logger.info(
								`Successfully got CoinGecko price for ${symbol}: ${stringify({
									priceInUSD: priceResponse.priceInUSD,
									amountValueInUSD,
								})}`,
							)
						} else {
							logger.warn(
								`No price data found in CoinGecko response for ${symbol} (${tokenAddress}). Revenue tracking skipped for this dust.`,
							)
							amountValueInUSD = "0"
						}
					}
				} catch (error) {
					logger.warn(
						`Failed to get CoinGecko price for ${symbol} (${tokenAddress}): ${stringify({
							error: error as unknown as Error,
						})}. Revenue tracking skipped for this dust.`,
					)
					amountValueInUSD = "0"
				}
			} else {
				const priceResponse = PriceHelper.getAmountValueInUSD(amount, decimals, price)
				amountValueInUSD = priceResponse.amountValueInUSD
			}

			// Skip updating if USD value is 0
			if (amountValueInUSD === "0" || new Decimal(amountValueInUSD).eq(0)) {
				logger.info(
					`Skipping ProtocolRevenue update for ${symbol} - USD value is 0: ${stringify({
						tokenAddress,
						amount: amount.toString(),
						symbol,
					})}`,
				)
				return
			}

			// Get or create ProtocolRevenue entity
			const protocolRevenueId = "protocol-revenue"
			let protocolRevenue = await ProtocolRevenue.get(protocolRevenueId)

			if (!protocolRevenue) {
				protocolRevenue = await ProtocolRevenue.create({
					id: protocolRevenueId,
					accrued: amountValueInUSD,
					withdrawn: "0",
				})
			} else {
				const currentAccrued = new Decimal(protocolRevenue.accrued)
				const newAccrued = currentAccrued.plus(new Decimal(amountValueInUSD))
				protocolRevenue.accrued = newAccrued.toFixed(18)
			}

			await protocolRevenue.save()

			logger.info(
				`ProtocolRevenue accrued updated: ${stringify({
					accrued: protocolRevenue.accrued,
					amountValueInUSD,
					symbol,
					tokenAddress,
				})}`,
			)
		} catch (error) {
			logger.error(
				`Failed to update ProtocolRevenue accrued: ${stringify({
					error: error as unknown as Error,
					tokenAddress,
					symbol,
				})}`,
			)
		}
	}

	/**
	 * Update ProtocolRevenue withdrawn amount
	 */
	private static async updateProtocolRevenueWithdrawn(
		tokenAddress: string,
		amount: bigint,
		symbol: string,
		timestamp: bigint,
	): Promise<void> {
		try {
			let decimals = 18

			if (tokenAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
				try {
					const tokenContract = ERC6160Ext20Abi__factory.connect(tokenAddress, api)
					decimals = await tokenContract.decimals()
				} catch (error) {
					logger.warn(
						`Failed to get decimals for token ${tokenAddress}: ${stringify({
							error: error as unknown as Error,
						})}`,
					)
				}
			}

			// Try to get price from TokenPriceService (whitelisted tokens)
			let price = await TokenPriceService.getPrice(symbol, timestamp)
			let amountValueInUSD: string

			// If price is 0 (non-whitelisted or unavailable), try CoinGecko directly as fallback
			if (price === 0) {
				logger.info(
					`Token ${symbol} not whitelisted or price unavailable, attempting CoinGecko fallback for ${tokenAddress}`,
				)
				try {
					const coingeckoResponse = await PriceHelper.getTokenPriceFromCoinGecko(symbol)
					if (coingeckoResponse instanceof Error) {
						logger.warn(
							`Failed to get CoinGecko price for ${symbol} (${tokenAddress}): ${stringify({
								error: coingeckoResponse,
							})}. Revenue tracking skipped for this dust.`,
						)
						amountValueInUSD = "0"
					} else {
						const priceData =
							coingeckoResponse[symbol.toLowerCase()] || coingeckoResponse[symbol.toUpperCase()]
						if (priceData?.usd) {
							price = priceData.usd
							const priceResponse = PriceHelper.getAmountValueInUSD(amount, decimals, price)
							amountValueInUSD = priceResponse.amountValueInUSD
							logger.info(
								`Successfully got CoinGecko price for ${symbol}: ${stringify({
									priceInUSD: priceResponse.priceInUSD,
									amountValueInUSD,
								})}`,
							)
						} else {
							logger.warn(
								`No price data found in CoinGecko response for ${symbol} (${tokenAddress}). Revenue tracking skipped for this dust.`,
							)
							amountValueInUSD = "0"
						}
					}
				} catch (error) {
					logger.warn(
						`Failed to get CoinGecko price for ${symbol} (${tokenAddress}): ${stringify({
							error: error as unknown as Error,
						})}. Revenue tracking skipped for this dust.`,
					)
					amountValueInUSD = "0"
				}
			} else {
				const priceResponse = PriceHelper.getAmountValueInUSD(amount, decimals, price)
				amountValueInUSD = priceResponse.amountValueInUSD
			}

			// Skip updating if USD value is 0
			if (amountValueInUSD === "0" || new Decimal(amountValueInUSD).eq(0)) {
				logger.info(
					`Skipping ProtocolRevenue update for ${symbol} - USD value is 0: ${stringify({
						tokenAddress,
						amount: amount.toString(),
						symbol,
					})}`,
				)
				return
			}

			// Get or create ProtocolRevenue entity
			const protocolRevenueId = "protocol-revenue"
			let protocolRevenue = await ProtocolRevenue.get(protocolRevenueId)

			if (!protocolRevenue) {
				protocolRevenue = await ProtocolRevenue.create({
					id: protocolRevenueId,
					accrued: "0",
					withdrawn: amountValueInUSD,
				})
			} else {
				const currentWithdrawn = new Decimal(protocolRevenue.withdrawn)
				const newWithdrawn = currentWithdrawn.plus(new Decimal(amountValueInUSD))
				protocolRevenue.withdrawn = newWithdrawn.toFixed(18)
			}

			await protocolRevenue.save()

			logger.info(
				`ProtocolRevenue withdrawn updated: ${stringify({
					withdrawn: protocolRevenue.withdrawn,
					amountValueInUSD,
					symbol,
					tokenAddress,
				})}`,
			)
		} catch (error) {
			logger.error(
				`Failed to update ProtocolRevenue withdrawn: ${stringify({
					error: error as unknown as Error,
					tokenAddress,
					symbol,
				})}`,
			)
		}
	}
}
