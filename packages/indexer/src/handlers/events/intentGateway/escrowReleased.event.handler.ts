import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { EscrowReleasedLog, OrderFilledLog } from "@/configs/src/types/abi-interfaces/IntentGatewayAbi"
import { IntentGatewayService } from "@/services/intentGateway.service"
import { OrderStatus } from "@/configs/src/types"

export async function handleEscrowReleasedEvent(event: EscrowReleasedLog): Promise<void> {
	logger.info(`Order Filled Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, block } = event
	const { commitment } = args!

	if (!args) return

	const timestamp = await getBlockTimestamp(block.hash, chainId)

	logger.info(
		`Escrow Released: ${stringify({
			commitment,
		})}`,
	)

	await IntentGatewayService.updateOrderStatus(commitment, OrderStatus.REDEEMED, {
		transactionHash,
		blockNumber,
		timestamp,
	})
}
