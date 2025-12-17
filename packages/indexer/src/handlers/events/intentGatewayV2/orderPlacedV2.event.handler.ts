import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { OrderPlacedLog } from "@/configs/src/types/abi-interfaces/IntentGatewayV2Abi"
import { DEFAULT_REFERRER, IntentGatewayV2Service, OrderV2 } from "@/services/intentGatewayV2.service"
import { OrderStatus } from "@/configs/src/types"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { Hex } from "viem"
import { wrap } from "@/utils/event.utils"
import { Interface } from "@ethersproject/abi"
import IntentGatewayV2Abi from "@/configs/abis/IntentGatewayV2.abi.json"

export const handleOrderPlacedEventV2 = wrap(async (event: OrderPlacedLog): Promise<void> => {
	logger.info(`[Intent Gateway V2] Order Placed Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, blockHash, transaction } = event
	if (!args) return

	const chain = getHostStateMachine(chainId)
	const timestamp = await getBlockTimestamp(blockHash, chain)
	let graffiti = DEFAULT_REFERRER
	let decodedOrder: OrderV2 | null = null

	if (transaction?.input) {
		logger.info(`Decoding transaction data for referral points: ${stringify(transaction.input)}`)

		try {
			const { name, args: decodedArgs } = new Interface(IntentGatewayV2Abi).parseTransaction({
				data: transaction.input,
			})
			logger.info(`Decoded graffiti: ${stringify({ graffiti: decodedArgs[1] })}`)

			if (name === "placeOrder") {
				// decodedArgs[0] is the order object, decodedArgs[1] is the graffiti
				decodedOrder = decodedArgs[0]

				if (decodedArgs[1].toLowerCase() !== args.user.toLowerCase()) {
					// Either Default Referrer or Actual Referrer
					logger.info(`Using ${stringify(decodedArgs[1])} as graffiti`)
					graffiti = decodedArgs[1] as Hex
				}
			}
		} catch (e: any) {
			logger.error(
				`Error decoding placeOrder args, using default referrer: ${stringify({
					error: e as unknown as Error,
				})}`,
			)
		}
	}

	if (decodedOrder) {
		const order: OrderV2 = {
			id: "",
			user: decodedOrder.user as Hex,
			sourceChain: decodedOrder.sourceChain,
			destChain: decodedOrder.destChain,
			deadline: decodedOrder.deadline,
			nonce: decodedOrder.nonce,
			fees: decodedOrder.fees,
			session: decodedOrder.session as Hex,
			predispatch: decodedOrder.predispatch,
			inputs: decodedOrder.inputs,
			outputs: decodedOrder.outputs,
		}

		logger.info(
			`[Intent Gateway V2] Computing Order Commitment: ${stringify({
				order,
			})}`,
		)

		const commitment = IntentGatewayV2Service.computeOrderCommitment(order)

		order.id = commitment

		logger.info(`[Intent Gateway V2] Order Commitment: ${commitment}`)

		await IntentGatewayV2Service.getOrCreateOrder(
			{ ...order, user: IntentGatewayV2Service.bytes32ToBytes20(order.user) as Hex },
			graffiti,
			{
				transactionHash,
				blockNumber,
				timestamp,
			},
		)

		await IntentGatewayV2Service.updateOrderStatus(commitment, OrderStatus.PLACED, {
			transactionHash,
			blockNumber,
			timestamp,
		})
	}
})
