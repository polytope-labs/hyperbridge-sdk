import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { OrderFilledLog } from "@/configs/src/types/abi-interfaces/IntentGatewayAbi"
import { OrderFilledService } from "@/services/orderFilled.service"

export async function handleOrderFilledEvent(event: OrderFilledLog): Promise<void> {
	logger.info(`Order Filled Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, block } = event
	const { commitment, filler } = args!

	if (!args) return

	const timestamp = await getBlockTimestamp(block.hash, chainId)

	logger.info(
		`Order Filled: ${stringify({
			commitment,
		})} by ${filler}`,
	)

	await OrderFilledService.getOrCreate(commitment, filler, {
		transactionHash,
		blockNumber,
		timestamp: Number(timestamp),
	})
}
