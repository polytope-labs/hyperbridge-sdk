import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { AssetReceivedLog } from "@/types/abi-interfaces/TokenGatewayAbi"
import { TokenGatewayService } from "@/services/tokenGateway.service"
import { Request, TeleportStatus } from "@/types"
import { getHostStateMachine, isSubstrateChain } from "@/utils/substrate.helpers"
import { RequestService } from "~/src/services/request.service"

export async function handleAssetReceivedEvent(event: AssetReceivedLog): Promise<void> {
	logger.info(`Asset Received Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, blockHash } = event
	const { amount, commitment, from, beneficiary, assetId } = args!

	const chain = getHostStateMachine(chainId)
	const timestamp = await getBlockTimestamp(blockHash, chain)

	logger.info(
		`Asset Received Event: ${stringify({
			amount,
			commitment,
			from,
			beneficiary,
			assetId,
		})}`,
	)

	const request = await Request.get(commitment)

	if (request && request.source && isSubstrateChain(request.source)) {
		await TokenGatewayService.getOrCreate(
			{
				to: beneficiary,
				dest: chain,
				amount: amount.toBigInt(),
				commitment,
				from,
				assetId,
				redeem: false,
			},
			{
				transactionHash,
				blockNumber,
				timestamp,
			},
		)
	}

	await TokenGatewayService.updateTeleportStatus(commitment, TeleportStatus.RECEIVED, {
		transactionHash,
		blockNumber,
		timestamp,
	})
}
