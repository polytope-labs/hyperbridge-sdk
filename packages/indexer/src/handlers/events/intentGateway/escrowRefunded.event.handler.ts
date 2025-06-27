// import { getBlockTimestamp } from "@/utils/rpc.helpers"
// import stringify from "safe-stable-stringify"
// import { EscrowRefundedLog } from "@/types/abi-interfaces/IntentGatewayAbi"
// import { IntentGatewayService } from "@/services/intentGateway.service"
// import { OrderStatus } from "@/types"
// import { getHostStateMachine } from "@/utils/substrate.helpers"

// export async function handleEscrowRefundedEvent(event: EscrowRefundedLog): Promise<void> {
// 	logger.info(`Order Filled Event: ${stringify(event)}`)

// 	const { blockNumber, transactionHash, args, block, blockHash } = event
// 	const { commitment } = args!

// 	if (!args) return

// 	const chain = getHostStateMachine(chainId)
// 	const timestamp = await getBlockTimestamp(blockHash, chain)

// 	logger.info(
// 		`Escrow Refunded: ${stringify({
// 			commitment,
// 		})}`,
// 	)

// 	await IntentGatewayService.updateOrderStatus(commitment, OrderStatus.REFUNDED, {
// 		transactionHash,
// 		blockNumber,
// 		timestamp,
// 	})
// }
