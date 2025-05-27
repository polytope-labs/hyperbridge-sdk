import { OrderPlaced } from "@/configs/src/types/models/OrderPlaced"
import { Order } from "hyperbridge-sdk"

export class OrderPlacedService {
	static async getOrCreate(
		order: Order,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: number
		},
	): Promise<OrderPlaced> {
		const { transactionHash, blockNumber, timestamp } = logsData

		let orderPlaced = await OrderPlaced.get(order.id!)

		// TODO: Get USD values for inputs and outputs
		if (!orderPlaced) {
			orderPlaced = await OrderPlaced.create({
				id: order.id!,
				user: order.user,
				sourceChain: order.sourceChain,
				destChain: order.destChain,
				commitment: order.id!,
				deadline: order.deadline,
				nonce: order.nonce,
				fees: order.fees,
				inputTokens: order.inputs.map((input) => input.token),
				inputAmounts: order.inputs.map((input) => input.amount),
				inputValuesUSD: order.inputs.map((input) => 0n),
				inputUSD: order.inputs.map((input) => 0n),
				outputTokens: order.outputs.map((output) => output.token),
				outputAmounts: order.outputs.map((output) => output.amount),
				outputValuesUSD: order.outputs.map((output) => 0n),
				outputUSD: order.outputs.map((output) => 0n),
				outputBeneficiaries: order.outputs.map((output) => output.beneficiary),
				calldata: order.callData,
				createdAt: new Date(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: BigInt(timestamp),
				transactionHash,
			})
		}

		return orderPlaced
	}

	static async getByCommitment(commitment: string): Promise<OrderPlaced | null> {
		const orderPlaced = await OrderPlaced.get(commitment)

		if (!orderPlaced) return null

		return orderPlaced
	}

	// Using onchain data to get the order value
	static async getOrderValue(order: Order): Promise<number> {
		const orderPlaced = await OrderPlaced.get(order.id!)

		if (!orderPlaced) return 0

		return 0
	}
}
