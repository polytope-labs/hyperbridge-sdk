import { ERC6160Ext20Abi__factory, TokenGatewayAbi__factory } from "@/configs/src/types/contracts"
import PriceHelper from "@/utils/price.helpers"
import {
	TeleportStatus,
	TeleportStatusMetadata,
	TokenGatewayAssetTeleported,
	ProtocolParticipant,
	RewardPointsActivityType,
} from "@/configs/src/types"
import { timestampToDate } from "@/utils/date.helpers"
import { hexToBytes, bytesToHex, hexToString } from "viem"
import type { Hex } from "viem"
import { TOKEN_GATEWAY_CONTRACT_ADDRESSES } from "@/addresses/tokenGateway.addresses"
import { PointsService } from "./points.service"
import Decimal from "decimal.js"

export interface IAssetDetails {
	erc20_address: string
	erc6160_address: string
	is_erc20: boolean
	is_erc6160: boolean
}

export interface ITeleportParams {
	to: string
	dest: string
	amount: bigint
	commitment: string
	from: string
	assetId: string
	redeem: boolean
}

export class TokenGatewayService {
	/**
	 * Get asset details
	 */
	static async getAssetDetails(asset_id: string): Promise<IAssetDetails> {
		const TOKEN_GATEWAY_CONTRACT_ADDRESS = TOKEN_GATEWAY_CONTRACT_ADDRESSES[chainId]
		const tokenGatewayContract = TokenGatewayAbi__factory.connect(TOKEN_GATEWAY_CONTRACT_ADDRESS, api)

		const erc20Address = await tokenGatewayContract.erc20(asset_id)
		const erc6160Address = await tokenGatewayContract.erc6160(asset_id)

		return {
			erc20_address: erc20Address,
			erc6160_address: erc6160Address,
			is_erc20: erc20Address !== null && erc20Address.trim().length > 0,
			is_erc6160: erc6160Address !== null && erc6160Address.trim().length > 0,
		}
	}

	/**
	 * Get or create a teleport record
	 */
	static async getOrCreate(
		teleportParams: ITeleportParams,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: bigint
		},
		sourceChain: string,
	): Promise<TokenGatewayAssetTeleported> {
		const { transactionHash, blockNumber, timestamp } = logsData

		let teleport = await TokenGatewayAssetTeleported.get(teleportParams.commitment)

		const tokenDetails = await this.getAssetDetails(teleportParams.assetId.toString())
		const tokenContract = ERC6160Ext20Abi__factory.connect(tokenDetails.erc20_address, api)
		const decimals = tokenDetails.is_erc20 ? await tokenContract.decimals() : 18

		const usdValue = await PriceHelper.getTokenPriceInUSDUniswap(
			teleportParams.assetId.toString(),
			teleportParams.amount,
			decimals,
		)

		if (!teleport) {
			teleport = await TokenGatewayAssetTeleported.create({
				id: teleportParams.commitment,
				from: this.bytes32ToBytes20(teleportParams.from),
				sourceChain: `EVM-${sourceChain}`,
				destChain: hexToString(teleportParams.dest as Hex),
				commitment: teleportParams.commitment,
				amount: teleportParams.amount,
				assetId: teleportParams.assetId.toString(),
				to: this.bytes32ToBytes20(teleportParams.to),
				redeem: teleportParams.redeem,
				status: TeleportStatus.TELEPORTED,
				usdValue: usdValue.amountValueInUSD,
				createdAt: timestampToDate(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: timestamp,
				transactionHash,
			})
			await teleport.save()

			// Award points for token teleport - using USD value directly
			const teleportValue = new Decimal(usdValue.amountValueInUSD)
			const pointsToAward = teleportValue.floor().toNumber()

			await PointsService.awardPoints(
				this.bytes32ToBytes20(teleportParams.from),
				`EVM-${sourceChain}`,
				BigInt(pointsToAward),
				ProtocolParticipant.USER,
				RewardPointsActivityType.TOKEN_TELEPORTED_POINTS,
				transactionHash,
				`Points awarded for teleporting token ${teleportParams.assetId} with value ${usdValue.amountValueInUSD} USD`,
				timestamp,
			)
		}

		return teleport
	}

	/**
	 * Get teleport by commitment
	 */
	static async getByCommitment(commitment: string): Promise<TokenGatewayAssetTeleported | undefined> {
		const teleport = await TokenGatewayAssetTeleported.get(commitment)
		return teleport
	}

	/**
	 * Update teleport status
	 */
	static async updateTeleportStatus(
		commitment: string,
		status: TeleportStatus,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: bigint
		},
	): Promise<void> {
		const { transactionHash, blockNumber, timestamp } = logsData

		const teleport = await TokenGatewayAssetTeleported.get(commitment)

		if (teleport) {
			teleport.status = status
			await teleport.save()

			// Deduct points when teleport is refunded
			if (status === TeleportStatus.REFUNDED) {
				const teleportValue = new Decimal(teleport.usdValue)
				const pointsToDeduct = teleportValue.floor().toNumber()

				await PointsService.deductPoints(
					teleport.from,
					teleport.sourceChain,
					BigInt(pointsToDeduct),
					ProtocolParticipant.USER,
					RewardPointsActivityType.TOKEN_TELEPORTED_POINTS,
					transactionHash,
					`Points deducted for refunded teleport ${commitment} with value ${teleport.usdValue} USD`,
					timestamp,
				)
			}
		}

		const teleportStatusMetadata = await TeleportStatusMetadata.create({
			id: `${commitment}.${status}`,
			status,
			chain: chainId,
			timestamp,
			blockNumber: blockNumber.toString(),
			transactionHash,
			teleportId: teleport?.id ?? "",
			createdAt: timestampToDate(timestamp),
		})

		await teleportStatusMetadata.save()
	}

	/**
	 * Convert bytes32 to bytes20 (address)
	 */
	private static bytes32ToBytes20(bytes32: string): string {
		if (bytes32 === "0x0000000000000000000000000000000000000000000000000000000000000000") {
			return "0x0000000000000000000000000000000000000000"
		}

		const bytes = hexToBytes(bytes32 as Hex)
		const addressBytes = bytes.slice(12)
		return bytesToHex(addressBytes) as Hex
	}
}
