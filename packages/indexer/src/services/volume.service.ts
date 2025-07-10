import Decimal from "decimal.js"

import { CumulativeVolumeUSD, DailyVolumeUSD } from "@/configs/src/types"
import { timestampToDate } from "@/utils/date.helpers"

export class VolumeService {
	private static readonly TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000
	private static readonly TWENTY_FOUR_HOURS_IN_SECONDS = 24 * 60 * 60

	/**
	 * Update cumulative volume for a given identifier
	 * @param id - The identifier for the cumulative volume record
	 * @param volumeUSD - The volume in USD to add
	 * @param timestamp - The timestamp of the transaction
	 */
	static async updateCumulativeVolume(id: string, volumeUSD: string, timestamp: bigint): Promise<void> {
		let cumulativeVolumeUSD = await CumulativeVolumeUSD.get(id)

		if (cumulativeVolumeUSD) {
			cumulativeVolumeUSD.volumeUSD = new Decimal(cumulativeVolumeUSD.volumeUSD)
				.plus(new Decimal(volumeUSD))
				.toFixed(18)
			cumulativeVolumeUSD.lastUpdatedAt = timestamp
		} else {
			cumulativeVolumeUSD = await CumulativeVolumeUSD.create({
				id,
				volumeUSD: new Decimal(volumeUSD).toFixed(18),
				lastUpdatedAt: timestamp,
			})
		}

		await cumulativeVolumeUSD.save()
	}

	/**
	 * Update daily volume for a given identifier
	 * Creates a new record every 24 hours
	 * @param id - The base identifier for the daily volume record
	 * @param volumeUSD - The volume in USD to add
	 * @param timestamp - The timestamp of the transaction
	 */
	static async updateDailyVolume(id: string, volumeUSD: string, timestamp: bigint): Promise<void> {
		const dailyRecordId = this.getDailyRecordId(id, timestamp)
		let dailyVolumeUSD = await DailyVolumeUSD.get(dailyRecordId)

		if (dailyVolumeUSD) {
			// Check if the existing record is still within 24 hours
			if (this.isWithin24Hours(dailyVolumeUSD.lastUpdatedAt, timestamp)) {
				// Update existing record
				dailyVolumeUSD.last24HoursVolumeUSD = new Decimal(dailyVolumeUSD.last24HoursVolumeUSD)
					.plus(new Decimal(volumeUSD))
					.toFixed(18)
				dailyVolumeUSD.lastUpdatedAt = timestamp
			} else {
				// Create new record for the new 24-hour period
				dailyVolumeUSD = await DailyVolumeUSD.create({
					id: dailyRecordId,
					last24HoursVolumeUSD: new Decimal(volumeUSD).toFixed(18),
					lastUpdatedAt: timestamp,
					createdAt: timestampToDate(timestamp),
				})
			}
		} else {
			// Create new record
			dailyVolumeUSD = await DailyVolumeUSD.create({
				id: dailyRecordId,
				last24HoursVolumeUSD: new Decimal(volumeUSD).toFixed(18),
				lastUpdatedAt: timestamp,
				createdAt: timestampToDate(timestamp),
			})
		}

		await dailyVolumeUSD.save()
	}

	/**
	 * Update both cumulative and daily volume in a single call
	 * @param id - The identifier for the volume records
	 * @param volumeUSD - The volume in USD to add
	 * @param timestamp - The timestamp of the transaction
	 */
	static async updateVolume(id: string, volumeUSD: string, timestamp: bigint): Promise<void> {
		await Promise.all([
			this.updateCumulativeVolume(id, volumeUSD, timestamp),
			this.updateDailyVolume(id, volumeUSD, timestamp),
		])
	}

	/**
	 * Generate a daily record ID based on the base ID and timestamp
	 * @param baseId - The base identifier
	 * @param timestamp - The timestamp
	 * @returns The daily record ID
	 */
	private static getDailyRecordId(baseId: string, timestamp: bigint): string {
		const date = timestampToDate(timestamp)
		const dateString = date.toISOString().split("T")[0] // Get YYYY-MM-DD format
		return `${baseId}.${dateString}`
	}

	/**
	 * Check if a timestamp is within 24 hours of another timestamp
	 * @param lastUpdatedAt - The last updated timestamp
	 * @param currentTimestamp - The current timestamp
	 * @returns True if within 24 hours, false otherwise
	 */
	private static isWithin24Hours(lastUpdatedAt: bigint, currentTimestamp: bigint): boolean {
		const timeDiffInSeconds = Number(currentTimestamp - lastUpdatedAt)
		return timeDiffInSeconds < this.TWENTY_FOUR_HOURS_IN_SECONDS
	}
}
