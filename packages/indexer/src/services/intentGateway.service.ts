import { OrderPlaced } from "@/configs/src/types/models/OrderPlaced"
import { OrderFilled, OrderStatus, OrderStatusMetadata } from "@/configs/src/types"
import { Order, bytes32ToBytes20 } from "hyperbridge-sdk"
import PriceHelper from "@/utils/price.helpers"
import { SUPPORTED_ASSETS_CONTRACT_ADDRESSES } from "@/constants"
import { timestampToDate } from "@/utils/date.helpers"
import { ERC6160Ext20Abi__factory } from "@/configs/src/types/contracts"

export class IntentGatewayService {
	static async getOrCreateOrder(
		order: Order,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: bigint
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
				status: OrderStatus.PLACED,
				createdAt: timestampToDate(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: timestamp,
				transactionHash,
			})
			await orderPlaced.save()
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
			tokens.map(async (token) => {
				// Read token decimals from the token address
				const tokenAddress = bytes32ToBytes20(token.token)
				const tokenContract = ERC6160Ext20Abi__factory.connect(tokenAddress, api)
				const decimals = await tokenContract.decimals()

				return this.getTokenPriceInUSD(tokenAddress, token.amount, decimals)
			}),
		)

		// Convert all numbers to integers (multiply by 10000 to preserve 4 decimal places)
		// then add them, then convert back to decimal
		const total = valuesUSD.reduce((acc, curr) => {
			const currInt = Math.round(curr.amountValueInUSD * 10000)
			const accInt = Math.round(acc * 10000)
			return (accInt + currInt) / 10000
		}, 0)

		return {
			total: Number(total.toFixed(4)),
			values: valuesUSD.map((value) => value.amountValueInUSD),
		}
	}

	// The IntentGatway currently only supports the following tokens:
	// - WETH
	// - Stablecoins
	private static async getTokenPriceInUSD(
		tokenAddress: string,
		amount: bigint,
		decimals: number,
	): Promise<{
		priceInUSD: number
		amountValueInUSD: number
	}> {
		try {
			// Non zero address means it's a stablecoin
			// Zero address means it's the native currency
			if (tokenAddress != "0x0000000000000000000000000000000000000000") {
				const amountNormalized = Number(amount) / Math.pow(10, decimals)
				return {
					priceInUSD: 1,
					amountValueInUSD: Number(amountNormalized.toFixed(4)),
				}
			}

			const priceInUSD = await PriceHelper.getNativeCurrencyPrice(chainId)
			// Price is already in 18 decimals from PriceHelper
			const priceNormalized = Number(priceInUSD) / Math.pow(10, 18)
			const amountNormalized = Number(amount) / Math.pow(10, decimals)
			const amountValueInUSD = priceNormalized * amountNormalized

			return {
				priceInUSD: priceNormalized,
				amountValueInUSD: Number(amountValueInUSD.toFixed(4)),
			}
		} catch (error) {
			logger.error(`Error getting token price for ${tokenAddress}: ${error}`)
			return {
				priceInUSD: 0,
				amountValueInUSD: 0,
			}
		}
	}

	static async updateOrderStatus(
		commitment: string,
		status: OrderStatus,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: bigint
		},
		filler?: string,
	): Promise<void> {
		const { transactionHash, blockNumber, timestamp } = logsData

		const orderPlaced = await OrderPlaced.get(commitment)

		if (orderPlaced) {
			orderPlaced.status = status
			await orderPlaced.save()
		}

		await OrderStatusMetadata.create({
			id: `${commitment}.${status}`,
			orderId: commitment,
			status,
			chain: chainId,
			timestamp,
			blockNumber: blockNumber.toString(),
			filler,
			transactionHash,
			createdAt: timestampToDate(timestamp),
		})
	}
}
