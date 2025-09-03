import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { OrderPlacedLog } from "@/configs/src/types/abi-interfaces/IntentGatewayAbi"
import { DEFAULT_REFERRER, IntentGatewayService, Order } from "@/services/intentGateway.service"
import { OrderStatus } from "@/configs/src/types"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { Hex, decodeFunctionData } from "viem"
import { wrap } from "@/utils/event.utils"
import IntentGatewayAbi from "@/configs/abis/IntentGateway.abi.json"
import { PointsService } from "@/services/points.service"

export const handleOrderPlacedEvent = wrap(async (event: OrderPlacedLog): Promise<void> => {
	logger.info(`Order Placed Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, block, blockHash, transaction } = event
	if (!args) return

	const chain = getHostStateMachine(chainId)
	const timestamp = await getBlockTimestamp(blockHash, chain)
	let graffiti = DEFAULT_REFERRER

	if (transaction?.input) {
		try {
			const { args } = decodeFunctionData({ abi: IntentGatewayAbi.abi, data: transaction.input as Hex })

			logger.info(`Decoded function with args count: ${args?.length || 0}`)

			if (args && args.length >= 2) {
				const decodedGraffiti = args[1] as Hex
				if (decodedGraffiti != graffiti) {
					graffiti = decodedGraffiti
				}
			}
		} catch (error) {
			logger.error(`Failed to decode transaction data for referral points: ${error}`, {
				transactionHash,
				error: stringify(error),
			})
		}
	}

	const order: Order = {
		id: "",
		user: args.user as Hex,
		sourceChain: args.sourceChain,
		destChain: args.destChain,
		deadline: args.deadline.toBigInt(),
		nonce: args.nonce.toBigInt(),
		fees: args.fees.toBigInt(),
		inputs: args.inputs.map((input) => ({
			token: input.token as Hex,
			amount: input.amount.toBigInt(),
		})),
		outputs: args.outputs.map((output) => ({
			token: output.token as Hex,
			amount: output.amount.toBigInt(),
			beneficiary: output.beneficiary as Hex,
		})),
		callData: args.callData as Hex,
	}

	logger.info(
		`Computing Order Commitment: ${stringify({
			order,
		})}`,
	)

	const commitment = IntentGatewayService.computeOrderCommitment(order)

	order.id = commitment

	logger.info(`Order Commitment: ${commitment}`)

	await IntentGatewayService.getOrCreateOrder(order, graffiti, {
		transactionHash,
		blockNumber,
		timestamp,
	})

	await IntentGatewayService.updateOrderStatus(commitment, OrderStatus.PLACED, {
		transactionHash,
		blockNumber,
		timestamp,
	})
})
