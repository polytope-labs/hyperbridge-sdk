import { OrderPlaced } from "@/configs/src/types/models/OrderPlaced"
import { Order, bytes32ToBytes20 } from "hyperbridge-sdk"
import PriceHelper from "@/utils/price.helpers"
import { SUPPORTED_ASSETS_CONTRACT_ADDRESSES } from "@/constants"

export class OrderPlacedService {
	static async getOrCreate(
		order: Order,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: number
		},
	): Promise<OrderPlaced> {
		const { transactionHash, blockNumber, timestamp } = logsData

		let orderPlaced = await OrderPlaced.get(order.id!)

		const { inputUSD, outputUSD, inputValuesUSD, outputValuesUSD } = await this.getOrderValue(order)

		if (!orderPlaced) {
			orderPlaced = await OrderPlaced.create({
				id: order.id!,
				user: order.user,
				sourceChain: order.sourceChain,
				destChain: order.destChain,
				commitment: order.id!,
				deadline: order.deadline,
				nonce: order.nonce,
				fees: order.fees,
				inputTokens: order.inputs.map((input) => input.token),
				inputAmounts: order.inputs.map((input) => input.amount),
				inputValuesUSD: inputValuesUSD.map((value) => BigInt(value)),
				inputUSD: BigInt(inputUSD),
				outputTokens: order.outputs.map((output) => output.token),
				outputAmounts: order.outputs.map((output) => output.amount),
				outputValuesUSD: outputValuesUSD.map((value) => BigInt(value)),
				outputUSD: BigInt(outputUSD),
				outputBeneficiaries: order.outputs.map((output) => output.beneficiary),
				calldata: order.callData,
				createdAt: new Date(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: BigInt(timestamp),
				transactionHash,
			})
		}

		return orderPlaced
	}

	static async getByCommitment(commitment: string): Promise<OrderPlaced | null> {
		const orderPlaced = await OrderPlaced.get(commitment)

		if (!orderPlaced) return null

		return orderPlaced
	}

	private static async getOrderValue(
		order: Order,
	): Promise<{ inputUSD: number; outputUSD: number; inputValuesUSD: number[]; outputValuesUSD: number[] }> {
		const inputValuesUSD = await this.getInputValuesUSD(order)
		const outputValuesUSD = await this.getOutputValuesUSD(order)

		return {
			inputUSD: inputValuesUSD.total,
			outputUSD: outputValuesUSD.total,
			inputValuesUSD: inputValuesUSD.values,
			outputValuesUSD: outputValuesUSD.values,
		}
	}

	private static async getInputValuesUSD(order: Order): Promise<{ total: number; values: number[] }> {
		return this.getTokenValuesUSD(order.inputs)
	}

	private static async getOutputValuesUSD(order: Order): Promise<{ total: number; values: number[] }> {
		return this.getTokenValuesUSD(order.outputs)
	}

	private static async getTokenValuesUSD(
		tokens: { token: string; amount: bigint }[],
	): Promise<{ total: number; values: number[] }> {
		const valuesUSD = await Promise.all(
			tokens.map((token) => this.getTokenPriceInUSD(bytes32ToBytes20(token.token), token.amount)),
		)
		return {
			total: valuesUSD.reduce((acc, curr) => acc + curr.amountValueInUSD, 0),
			values: valuesUSD.map((value) => value.amountValueInUSD),
		}
	}

	private static async getTokenPriceInUSD(
		tokenAddress: string,
		amount: bigint,
	): Promise<{
		priceInUSD: number
		amountValueInUSD: number
	}> {
		try {
			const supportedAssets = SUPPORTED_ASSETS_CONTRACT_ADDRESSES[chainId] || []
			const tokenDetails = supportedAssets.find(
				(asset) => asset.address.toLowerCase() === tokenAddress.toLowerCase(),
			)

			if (!tokenDetails) {
				logger.warn(`No price feed found for token ${tokenAddress} on chain ${chainId}`)
				return {
					priceInUSD: 0,
					amountValueInUSD: 0,
				}
			}

			const priceInUSD = await PriceHelper.getTokenPriceInUsd(tokenDetails)

			const amountValueInUSD = (priceInUSD * amount) / BigInt(10 ** 18)

			return {
				priceInUSD: Number(priceInUSD) / 1e18,
				amountValueInUSD: Number(amountValueInUSD),
			}
		} catch (error) {
			logger.error(`Error getting token price for ${tokenAddress}: ${error}`)
			return {
				priceInUSD: 0,
				amountValueInUSD: 0,
			}
		}
	}
}
