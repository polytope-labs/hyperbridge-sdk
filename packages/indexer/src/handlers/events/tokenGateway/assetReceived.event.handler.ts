import stringify from "safe-stable-stringify"

import { Request, TeleportStatus } from "@/types"
import { AssetReceivedLog } from "@/types/abi-interfaces/TokenGatewayAbi"
import { TokenGatewayService } from "@/services/tokenGateway.service"
import { VolumeService } from "@/services/volume.service"
import { getHostStateMachine, isSubstrateChain } from "@/utils/substrate.helpers"
import PriceHelper from "@/utils/price.helpers"
import { getBlockTimestamp } from "@/utils/rpc.helpers"
import { wrap } from "@/utils/event.utils"

export const handleAssetReceivedEvent = wrap(async (event: AssetReceivedLog): Promise<void> => {
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

	// NOTE: ERC20 token transfer already indexed via Token Transfer
	const asset = await TokenGatewayService.getAssetDetails(assetId.toString())
	if (!asset.is_erc20) {
		const tokenContract = await TokenGatewayService.getAssetTokenContract(assetId.toString())
		const decimals = await tokenContract.decimals()
		const symbol = await tokenContract.symbol()

		const usdValue = await PriceHelper.getTokenPriceInUSDCoingecko(symbol, amount.toBigInt(), decimals)

		await VolumeService.updateVolume("TokenGateway", usdValue.amountValueInUSD, timestamp)
	}

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
})
