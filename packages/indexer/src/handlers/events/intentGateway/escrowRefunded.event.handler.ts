import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { EscrowRefundedLog } from "@/configs/src/types/abi-interfaces/IntentGatewayAbi"
import { IntentGatewayService } from "@/services/intentGateway.service"

export async function handleEscrowRefundedEvent(event: EscrowRefundedLog): Promise<void> {
	logger.info(`Order Filled Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, block } = event
	const { commitment } = args!

	if (!args) return

	const timestamp = await getBlockTimestamp(block.hash, chainId)

	logger.info(
		`Escrow Refunded: ${stringify({
			commitment,
		})}`,
	)

	await IntentGatewayService.getOrCreateEscrowRefunded(commitment, {
		transactionHash,
		blockNumber,
		timestamp: Number(timestamp),
	})
}
