import { SubstrateEvent } from "@subql/types"
import { Treasury } from "@/configs/src/types"
import { Balance } from "@polkadot/types/interfaces"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { getHostStateMachine } from "@/utils/substrate.helpers"
import { timestampToDate } from "@/utils/date.helpers"

const TREASURY_ADDRESS = "13UVJyLkyUpEiXBx5p776dHQoBuuk3Y5PYp5Aa89rYWePWA3"

export async function handleTreasuryTransfer(event: SubstrateEvent): Promise<void> {
	const {
		event: { data },
		block,
	} = event

	const fromAddress = data[0].toString()
	const toAddress = data[1].toString()

	if (fromAddress !== TREASURY_ADDRESS && toAddress !== TREASURY_ADDRESS) {
		return
	}

	const amount = (data[2] as unknown as Balance).toBigInt()

	let treasury = await Treasury.get(TREASURY_ADDRESS)
	if (!treasury) {
		treasury = Treasury.create({
			id: TREASURY_ADDRESS,
			totalAmountTransferredIn: BigInt(0),
			totalAmountTransferredOut: BigInt(0),
			totalBalance: BigInt(0),
			lastUpdatedAt: new Date(block.timestamp!),
		})
	}

	if (fromAddress === TREASURY_ADDRESS) {
		treasury.totalAmountTransferredOut += amount
	} else {
		treasury.totalAmountTransferredIn += amount
	}

	treasury.totalBalance = treasury.totalAmountTransferredIn - treasury.totalAmountTransferredOut
	const hyperbridgeChain = getHostStateMachine(chainId)
	const timestamp = await getBlockTimestamp(event.block.block.header.hash.toString(), hyperbridgeChain)
	treasury.lastUpdatedAt = timestampToDate(timestamp)

	await treasury.save()
}
