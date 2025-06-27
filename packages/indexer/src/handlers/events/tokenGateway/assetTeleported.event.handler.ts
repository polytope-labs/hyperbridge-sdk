import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { AssetTeleportedLog } from "@/types/abi-interfaces/TokenGatewayAbi"
import { TokenGatewayService } from "@/services/tokenGateway.service"
import { TeleportStatus } from "@/types"
import { getHostStateMachine, isSubstrateChain } from "@/utils/substrate.helpers"

export async function handleAssetTeleportedEvent(event: AssetTeleportedLog): Promise<void> {
	logger.info(`Asset Teleported Event: ${stringify(event)}`)

	const { blockNumber, transactionHash, args, block, blockHash } = event
	const { to, dest, amount, commitment, from, assetId, redeem } = args!

	const chain = getHostStateMachine(chainId)
	const timestamp = await getBlockTimestamp(blockHash, chain)

	logger.info(
		`Asset Teleported Event: ${stringify({
			to,
			dest,
			amount,
			commitment,
			from,
			assetId,
			redeem,
		})}`,
	)

	await TokenGatewayService.getOrCreate(
		{
			to,
			dest,
			amount: amount.toBigInt(),
			commitment,
			from,
			assetId,
			redeem,
		},
		{
			transactionHash,
			blockNumber,
			timestamp,
		},
	)

	await TokenGatewayService.updateTeleportStatus(commitment, TeleportStatus.TELEPORTED, {
		transactionHash,
		blockNumber,
		timestamp,
	})
}
