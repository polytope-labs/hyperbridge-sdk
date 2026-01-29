import { SubstrateBlock } from "@subql/types"
import { MigrationState, RelayerChainStats, RelayerStatsPerChain, Relayer } from "@/configs/src/types"
import { decodeRelayerAddress } from "@/utils/substrate.helpers"

const MIGRATION_ID = "relayer-stats-per-chain-to-relayer-chain-stats"
const BATCH_SIZE = 10

/**
 * Checks if a string needs relayer address decoding.
 * Returns true if:
 * - It's a hex string (0x...) longer than 42 chars (more than 20 bytes, so not a valid EVM address)
 * - This indicates it might be a raw 32-byte public key or SCALE-encoded signature
 *
 * EVM addresses are 20 bytes = 40 hex chars + "0x" = 42 chars total
 * Substrate public keys are 32 bytes = 64 hex chars + "0x" = 66 chars total
 */
function needsDecoding(relayerId: string): boolean {
	return relayerId.startsWith("0x") && relayerId.length > 42
}

/**
 * Safely decodes a relayer address, returning the original if decoding fails
 */
function safeDecodeRelayerAddress(relayerId: string): string {
	if (!needsDecoding(relayerId)) {
		return relayerId
	}

	try {
		const decoded = decodeRelayerAddress(relayerId)
		logger.info(`[Migration] Decoded relayer: ${relayerId.slice(0, 20)}... -> ${decoded}`)
		return decoded
	} catch (error) {
		logger.warn(`[Migration] Could not decode relayer ${relayerId.slice(0, 20)}..., using as-is`)
		return relayerId
	}
}

/**
 * Migration handler to migrate RelayerStatsPerChain to RelayerChainStats
 * This handler runs on each block and migrates 10 items at a time
 * Only migrates EVM chain stats (chain starts with "EVM-")
 */
export async function handleRelayerStatsMigration(block: SubstrateBlock): Promise<void> {
	try {
		let migrationState = await MigrationState.get(MIGRATION_ID)

		if (migrationState?.isComplete) {
			return
		}

		if (!migrationState) {
			migrationState = MigrationState.create({
				id: MIGRATION_ID,
				migratedCount: 0,
				processedCount: 0,
				totalCount: 0,
				isComplete: false,
				lastBlockNumber: block.block.header.number.toBigInt(),
				lastUpdatedAt: new Date(block.timestamp!),
			})
			await migrationState.save()
			logger.info(`[Migration] Initialized migration state`)
		}


		const allRecords = await RelayerStatsPerChain.getByFields(
			[],
			{
				limit: BATCH_SIZE,
				offset: migrationState.processedCount,
				orderBy: "id",
				orderDirection: "ASC",
			}
		)

		if (allRecords.length === 0) {
			migrationState.isComplete = true
			migrationState.totalCount = migrationState.migratedCount
			migrationState.lastBlockNumber = block.block.header.number.toBigInt()
			migrationState.lastUpdatedAt = new Date(block.timestamp!)
			await migrationState.save()
			logger.info(`[Migration] Migration complete! Total migrated: ${migrationState.migratedCount}`)
			return
		}

		const evmRecords = allRecords.filter(r => r.chain.startsWith("EVM-"))

		for (const oldRecord of evmRecords) {
			const decodedRelayerId = safeDecodeRelayerAddress(oldRecord.relayerId)
			const chain = oldRecord.chain

			let relayer = await Relayer.get(decodedRelayerId)
			if (!relayer) {
				relayer = Relayer.create({ id: decodedRelayerId })
				await relayer.save()
			}

			const newId = `${decodedRelayerId}-${chain}`
			let newStats = await RelayerChainStats.get(newId)

			if (!newStats) {
				newStats = RelayerChainStats.create({
					id: newId,
					relayerId: decodedRelayerId,
					chain: chain,
					numberOfSuccessfulMessagesDelivered: oldRecord.numberOfSuccessfulMessagesDelivered ?? BigInt(0),
					numberOfFailedMessagesDelivered: oldRecord.numberOfFailedMessagesDelivered ?? BigInt(0),
					gasUsedForSuccessfulMessages: oldRecord.gasUsedForSuccessfulMessages ?? BigInt(0),
					gasUsedForFailedMessages: oldRecord.gasUsedForFailedMessages ?? BigInt(0),
					gasFeeForSuccessfulMessages: oldRecord.gasFeeForSuccessfulMessages ?? BigInt(0),
					gasFeeForFailedMessages: oldRecord.gasFeeForFailedMessages ?? BigInt(0),
					usdGasFeeForSuccessfulMessages: oldRecord.usdGasFeeForSuccessfulMessages ?? BigInt(0),
					usdGasFeeForFailedMessages: oldRecord.usdGasFeeForFailedMessages ?? BigInt(0),
					feesEarned: oldRecord.feesEarned ?? BigInt(0),
				})
				await newStats.save()
				logger.info(`[Migration] Migrated: ${newId}`)
			} else {
				newStats.numberOfSuccessfulMessagesDelivered += oldRecord.numberOfSuccessfulMessagesDelivered ?? BigInt(0)
				newStats.numberOfFailedMessagesDelivered += oldRecord.numberOfFailedMessagesDelivered ?? BigInt(0)
				newStats.gasUsedForSuccessfulMessages += oldRecord.gasUsedForSuccessfulMessages ?? BigInt(0)
				newStats.gasUsedForFailedMessages += oldRecord.gasUsedForFailedMessages ?? BigInt(0)
				newStats.gasFeeForSuccessfulMessages += oldRecord.gasFeeForSuccessfulMessages ?? BigInt(0)
				newStats.gasFeeForFailedMessages += oldRecord.gasFeeForFailedMessages ?? BigInt(0)
				newStats.usdGasFeeForSuccessfulMessages += oldRecord.usdGasFeeForSuccessfulMessages ?? BigInt(0)
				newStats.usdGasFeeForFailedMessages += oldRecord.usdGasFeeForFailedMessages ?? BigInt(0)
				newStats.feesEarned += oldRecord.feesEarned ?? BigInt(0)
				await newStats.save()
				logger.info(`[Migration] Aggregated duplicate: ${newId} (from ${oldRecord.relayerId.slice(0, 20)}...)`)
			}
		}

		migrationState.processedCount += allRecords.length
		migrationState.migratedCount += evmRecords.length
		migrationState.lastBlockNumber = block.block.header.number.toBigInt()
		migrationState.lastUpdatedAt = new Date(block.timestamp!)

		logger.info(`[Migration] Progress: ${migrationState.migratedCount} EVM records migrated, ${migrationState.processedCount} total processed`)

		await migrationState.save()
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		logger.error(`[Migration] Error during migration: ${errorMessage}`)
	}
}
