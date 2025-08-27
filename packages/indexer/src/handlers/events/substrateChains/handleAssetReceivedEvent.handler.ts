import { SubstrateEvent } from "@subql/types"
import { formatChain, getHexFromSS58Address, getHostStateMachine } from "@/utils/substrate.helpers"
import stringify from "safe-stable-stringify"
import { wrap } from "@/utils/event.utils"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { AssetReceivedService } from "@/services/assetReceived.service"

export const handleSubstrateAssetReceivedEvent = wrap(async (event: SubstrateEvent): Promise<void> => {
	logger.info(`Saw XcmGateway.AssetReceived Event on ${getHostStateMachine(chainId)}`)
	logger.info(`Handling handleSubstrateAssetReceivedEvent ${stringify(event)}`)

	if (!event.event.data) return

	// TODO: fix codec type interface
	const [beneficiary, amount, source ] = event.event.data

	const host = getHostStateMachine(chainId)
	const toHex = getHexFromSS58Address(beneficiary.toString())
	const sourceId = formatChain(source.toString())

	const blockHash = event.block.block.header.hash.toString()
	const blockNumber = event.block.block.header.number.toString()
	const blockTimestamp = await getBlockTimestamp(event.block.block.header.hash.toString(), host)

	logger.info(
		`Handling AssetReceived Event: ${stringify({
			host,
			toHex,
			sourceId,
			beneficiary,
			amount,
			source,
			blockHash,
			blockNumber,
			blockTimestamp,
		})}`,
	)

	await AssetReceivedService.createOrUpdate({
		//	from: fromHex,
		to: toHex,
		amount: BigInt(amount.toString()),
		source: sourceId,
		//	commitment: commitment.toString(),
		chain: host,
		blockNumber: event.block.block.header.number.toString(),
		blockHash: event.block.block.header.hash.toString(),
		blockTimestamp,
	})
})
