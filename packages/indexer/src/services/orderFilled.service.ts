import { OrderFilled } from "@/configs/src/types"

export class OrderFilledService {
	static async getOrCreate(
		commitment: string,
		filler: string,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: number
		},
	): Promise<OrderFilled> {
		const { transactionHash, blockNumber, timestamp } = logsData

		let orderFilled = await OrderFilled.get(commitment)

		if (!orderFilled) {
			orderFilled = await OrderFilled.create({
				id: commitment,
				filler,
				orderId: commitment,
				createdAt: new Date(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: BigInt(timestamp),
				transactionHash,
			})
		}

		return orderFilled
	}
}
