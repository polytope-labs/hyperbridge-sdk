import { AssetReceived } from "@/configs/src/types/models"
import { timestampToDate } from "@/utils/date.helpers"

// Arguments for creating AssetReceived records
export interface IAssetReceivedArgs {
	to: string
	amount: bigint
	source: string
	chain: string
	blockNumber: string
	blockHash: string
	blockTimestamp: bigint
}

export class AssetReceivedService {
	/**
	 * Create or update an AssetTeleported record
	 */
	static async createOrUpdate(args: IAssetReceivedArgs): Promise<AssetReceived> {
		const { to, amount, source, chain, blockNumber, blockHash, blockTimestamp } = args

		// TODO: get the actual commitment hash or assetId
		const id = "" // commitment

		let assetReceived = await AssetReceived.get(id)
		if (!assetReceived) {
			assetReceived = AssetReceived.create({
				id,
				// from,
				to,
				amount,
				source,
				// commitment,
				chain,
				blockNumber: parseInt(blockNumber),
				createdAt: timestampToDate(blockTimestamp), // Using block timestamp for createdAt instead of current time
			})
		}

		await assetReceived.save()
		return assetReceived
	}
}
