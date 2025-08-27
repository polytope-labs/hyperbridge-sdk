import { SubstrateEvent } from "@subql/types"
import { formatChain, getHexFromSS58Address, getHostStateMachine } from "@/utils/substrate.helpers"
import { AssetTeleportedService } from "@/services/assetTeleported.service"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import stringify from "safe-stable-stringify"
import { wrap } from "@/utils/event.utils"

export const handleSubstrateAssetTeleportedEvent = wrap(async (event: SubstrateEvent): Promise<void> => {
	logger.info(`Saw XcmGateway.AssetTeleported Event on ${getHostStateMachine(chainId)}`)

	if (!event.event.data) return

	const [from, to, amount, dest, commitment] = event.event.data

	const fromHex = getHexFromSS58Address(from.toString())

	logger.info(
		`Handling AssetTeleported Event: ${stringify({
			from: fromHex,
			to: to.toString(),
			amount: amount.toString(),
			dest: dest.toString(),
			commitment: commitment.toString(),
		})}`,
	)

	const destId = formatChain(dest.toString())
	const host = getHostStateMachine(chainId)

	const blockTimestamp = await getBlockTimestamp(event.block.block.header.hash.toString(), host)

	await AssetTeleportedService.createOrUpdate({
		from: fromHex,
		to: to.toString(),
		amount: BigInt(amount.toString()),
		dest: destId,
		commitment: commitment.toString(),
		chain: host,
		blockNumber: event.block.block.header.number.toString(),
		blockHash: event.block.block.header.hash.toString(),
		blockTimestamp,
	})
})
