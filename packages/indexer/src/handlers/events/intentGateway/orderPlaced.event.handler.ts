import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { OrderPlacedLog } from "@/configs/src/types/abi-interfaces/IntentGatewayAbi"
import { HexString, Order, orderCommitment } from "hyperbridge-sdk"
import { IntentGatewayService } from "@/services/intentGateway.service"

export async function handleOrderPlacedEvent(event: OrderPlacedLog): Promise<void> {
	logger.info(`Order Placed Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, block } = event

	if (!args) return

	const order: Order = {
		user: args!.user as HexString,
		sourceChain: args!.sourceChain as HexString,
		destChain: args!.destChain as HexString,
		deadline: args!.deadline.toBigInt(),
		nonce: args!.nonce.toBigInt(),
		fees: args!.fees.toBigInt(),
		inputs: args!.inputs.map((input) => ({
			token: input.token as HexString,
			amount: input.amount.toBigInt(),
		})),
		outputs: args!.outputs.map((output) => ({
			token: output.token as HexString,
			amount: output.amount.toBigInt(),
			beneficiary: output.beneficiary as HexString,
		})),
		callData: args!.callData as HexString,
	}
	const timestamp = await getBlockTimestamp(block.hash, order.sourceChain)

	logger.info(
		`Computing Order Commitment: ${stringify({
			order,
		})}`,
	)

	const commitment = orderCommitment(order)

	order.id = commitment

	logger.info(`Order Commitment: ${commitment}`)

	await IntentGatewayService.getOrCreateOrder(order, {
		transactionHash,
		blockNumber,
		timestamp: Number(timestamp),
	})
}
