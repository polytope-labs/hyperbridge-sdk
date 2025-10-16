import Decimal from "decimal.js"
import { ethers } from "ethers"
import type { Hex } from "viem"
import { hexToBytes, bytesToHex, keccak256, encodeAbiParameters } from "viem"

import { OrderStatus, OrderStatusMetadata, ProtocolParticipantType, PointsActivityType } from "@/configs/src/types"
import { ERC6160Ext20Abi__factory } from "@/configs/src/types/contracts"
import { Order as OrderPlaced } from "@/configs/src/types/models/Order"
import { timestampToDate } from "@/utils/date.helpers"

import { PointsService } from "./points.service"
import { VolumeService } from "./volume.service"
import PriceHelper from "@/utils/price.helpers"
import { TokenPriceService } from "./token-price.service"
import stringify from "safe-stable-stringify"
import { getOrCreateUser } from "./userActivity.services"

export interface TokenInfo {
	token: Hex
	amount: bigint
}

export interface PaymentInfo extends TokenInfo {
	beneficiary: Hex
}

export interface Order {
	id?: string
	user: Hex
	sourceChain: string
	destChain: string
	deadline: bigint
	nonce: bigint
	fees: bigint
	outputs: PaymentInfo[]
	inputs: TokenInfo[]
	callData: Hex
}

export const DEFAULT_REFERRER = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex

export class IntentGatewayService {
	static async getOrCreateOrder(
		order: Order,
		referrer: string,
		logsData: {
			transactionHash: string
			blockNumber: number
			timestamp: bigint
		},
	): Promise<OrderPlaced> {
		const { transactionHash, blockNumber, timestamp } = logsData

		let orderPlaced = await OrderPlaced.get(order.id!)
		const { inputUSD, inputValuesUSD } = await this.getOrderValue(order)

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
				inputValuesUSD: inputValuesUSD,
				inputUSD: inputUSD,
				outputTokens: order.outputs.map((output) => output.token),
				outputAmounts: order.outputs.map((output) => output.amount),
				outputBeneficiaries: order.outputs.map((output) => output.beneficiary),
				calldata: order.callData,
				status: OrderStatus.PLACED,
				referrer,
				createdAt: timestampToDate(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: timestamp,
				transactionHash,
			})
			await orderPlaced.save()

			logger.info(
				`Order Placed Event successfully saved: ${stringify({
					orderPlaced,
				})}`,
			)

			logger.info("Now awarding points for the Order Placed Event")

			// Award points for order placement - using USD value directly
			const orderValue = new Decimal(inputUSD)
			const pointsToAward = orderValue.floor().toNumber()

			await PointsService.awardPoints(
				this.bytes32ToBytes20(order.user),
				ethers.utils.toUtf8String(order.sourceChain),
				BigInt(pointsToAward),
				ProtocolParticipantType.USER,
				PointsActivityType.ORDER_PLACED_POINTS,
				transactionHash,
				`Points awarded for placing order ${order.id} with value ${inputUSD} USD`,
				timestamp,
			)

			await VolumeService.updateVolume("IntentGateway.USER", inputUSD, timestamp)
		} else {
			// Handle race condition: Order already exists (e.g., was filled first)
			// Update all fields except status and status-related metadata
			logger.info(
				`Order ${order.id} already exists with status ${orderPlaced.status}. Updating order details while preserving status.`,
			)

			const existingStatus = orderPlaced.status
			orderPlaced.user = order.user
			orderPlaced.sourceChain = order.sourceChain
			orderPlaced.destChain = order.destChain
			orderPlaced.deadline = order.deadline
			orderPlaced.nonce = order.nonce
			orderPlaced.fees = order.fees
			orderPlaced.inputTokens = order.inputs.map((input) => input.token)
			orderPlaced.inputAmounts = order.inputs.map((input) => input.amount)
			orderPlaced.inputValuesUSD = inputValuesUSD
			orderPlaced.inputUSD = inputUSD
			orderPlaced.outputTokens = order.outputs.map((output) => output.token)
			orderPlaced.outputAmounts = order.outputs.map((output) => output.amount)
			orderPlaced.outputBeneficiaries = order.outputs.map((output) => output.beneficiary)
			orderPlaced.calldata = order.callData
			orderPlaced.referrer = referrer
			// Keep existing status - don't overwrite it

			await orderPlaced.save()

			logger.info(`Order ${order.id} updated with actual data. Status remains: ${existingStatus}`)

			// Award points for order placement - using USD value directly
			// Only award if status is not already FILLED (to avoid double awarding)
			if (existingStatus !== OrderStatus.FILLED) {
				logger.info("Now awarding points for the Order Placed Event")

				const orderValue = new Decimal(inputUSD)
				const pointsToAward = orderValue.floor().toNumber()

				await PointsService.awardPoints(
					this.bytes32ToBytes20(order.user),
					ethers.utils.toUtf8String(order.sourceChain),
					BigInt(pointsToAward),
					ProtocolParticipantType.USER,
					PointsActivityType.ORDER_PLACED_POINTS,
					transactionHash,
					`Points awarded for placing order ${order.id} with value ${inputUSD} USD`,
					timestamp,
				)

				await VolumeService.updateVolume("IntentGateway.USER", inputUSD, timestamp)
			}
		}

		let user = await getOrCreateUser(order.user, referrer, timestamp)
		user.referrer = user.referrer === DEFAULT_REFERRER ? referrer : user.referrer
		user.totalOrdersPlaced = user.totalOrdersPlaced + BigInt(1)
		user.totalOrderPlacedVolumeUSD = new Decimal(user.totalOrderPlacedVolumeUSD)
			.plus(new Decimal(inputUSD))
			.toString()

		await user.save()

		return orderPlaced
	}

	static async getByCommitment(commitment: string): Promise<OrderPlaced | null> {
		const orderPlaced = await OrderPlaced.get(commitment)

		if (!orderPlaced) return null

		return orderPlaced
	}

	private static async getOrderValue(order: Order): Promise<{ inputUSD: string; inputValuesUSD: string[] }> {
		const inputValuesUSD = await this.getInputValuesUSD(order)

		return {
			inputUSD: inputValuesUSD.total,
			inputValuesUSD: inputValuesUSD.values,
		}
	}

	private static async getInputValuesUSD(order: Order): Promise<{ total: string; values: string[] }> {
		return this.getTokenValuesUSD(order.inputs)
	}

	private static async getOutputValuesUSD(outputs: PaymentInfo[]): Promise<{ total: string; values: string[] }> {
		return this.getTokenValuesUSD(outputs)
	}

	private static async getTokenValuesUSD(
		tokens: { token: string; amount: bigint }[],
	): Promise<{ total: string; values: string[] }> {
		const valuesUSD = await Promise.all(
			tokens.map(async (token) => {
				const tokenAddress = this.bytes32ToBytes20(token.token)
				let decimals = 18
				let symbol = "eth"

				if (tokenAddress != "0x0000000000000000000000000000000000000000") {
					const tokenContract = ERC6160Ext20Abi__factory.connect(tokenAddress, api)
					decimals = await tokenContract.decimals()
					symbol = await tokenContract.symbol()
				}

				const price = await TokenPriceService.getPrice(symbol)
				return PriceHelper.getAmountValueInUSD(token.amount, decimals, price)
			}),
		)

		const total = valuesUSD.reduce((acc, curr) => {
			return acc.plus(new Decimal(curr.amountValueInUSD))
		}, new Decimal(0))

		return {
			total: total.toFixed(18),
			values: valuesUSD.map((value) => value.amountValueInUSD),
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

		let orderPlaced = await OrderPlaced.get(commitment)

		// For race condtions, we create a placeholder order that will be updated when the PLACED event arrives
		if (!orderPlaced && status != OrderStatus.PLACED) {
			logger.warn(`Order ${commitment} does not exist yet but FILLED event received. Creating placeholder order.`)

			orderPlaced = await OrderPlaced.create({
				id: commitment,
				user: "0x0000000000000000000000000000000000000000",
				sourceChain: "",
				destChain: "",
				commitment: commitment,
				deadline: BigInt(0),
				nonce: BigInt(0),
				fees: BigInt(0),
				inputTokens: [],
				inputAmounts: [],
				inputValuesUSD: [],
				inputUSD: "0",
				outputTokens: [],
				outputAmounts: [],
				outputBeneficiaries: [],
				calldata: "0x",
				status: OrderStatus.FILLED,
				referrer: DEFAULT_REFERRER,
				createdAt: timestampToDate(timestamp),
				blockNumber: BigInt(blockNumber),
				blockTimestamp: timestamp,
				transactionHash,
			})
			await orderPlaced.save()

			logger.info(`Placeholder order with status FILLED created for commitment ${commitment}`)
		}

		if (orderPlaced) {
			orderPlaced.status = status === OrderStatus.PLACED ? orderPlaced.status : status
			await orderPlaced.save()

			// Award points for order filling - using USD value directly
			if (status === OrderStatus.FILLED && filler) {
				// Volume
				let outputPaymentInfo: PaymentInfo[] = orderPlaced.outputTokens.map((token, index) => {
					return {
						token: token as Hex,
						amount: orderPlaced.outputAmounts[index],
						beneficiary: orderPlaced.outputBeneficiaries[index] as Hex,
					}
				})
				let outputUSD = await this.getOutputValuesUSD(outputPaymentInfo)
				await VolumeService.updateVolume(`IntentGateway.FILLER.${filler}`, outputUSD.total, timestamp)

				const orderValue = new Decimal(orderPlaced.inputUSD)
				const pointsToAward = orderValue.floor().toNumber()

				// Rewards
				await PointsService.awardPoints(
					filler,
					ethers.utils.toUtf8String(orderPlaced.destChain),
					BigInt(pointsToAward),
					ProtocolParticipantType.FILLER,
					PointsActivityType.ORDER_FILLED_POINTS,
					transactionHash,
					`Points awarded for filling order ${commitment} with value ${orderPlaced.inputUSD} USD`,
					timestamp,
				)

				if (orderPlaced.referrer != DEFAULT_REFERRER) {
					const referrerPointsToAward = Math.floor(pointsToAward / 2)

					await PointsService.awardPoints(
						orderPlaced.referrer ?? DEFAULT_REFERRER,
						ethers.utils.toUtf8String(orderPlaced.sourceChain),
						BigInt(referrerPointsToAward),
						ProtocolParticipantType.REFERRER,
						PointsActivityType.ORDER_REFERRED_POINTS,
						transactionHash,
						`Points awarded for filling order ${commitment} with value ${orderPlaced.inputUSD} USD`,
						timestamp,
					)
				}

				// User
				let user = await getOrCreateUser(orderPlaced.user)
				user.totalOrderFilledVolumeUSD = new Decimal(user.totalOrderFilledVolumeUSD)
					.plus(new Decimal(orderPlaced.inputUSD))
					.toString()
				user.totalFilledOrders = user.totalFilledOrders + BigInt(1)
				await user.save()
			}

			// Deduct points when order is cancelled
			if (status === OrderStatus.REFUNDED) {
				const orderValue = new Decimal(orderPlaced.inputUSD)
				const pointsToDeduct = orderValue.floor().toNumber()

				await PointsService.deductPoints(
					orderPlaced.user,
					orderPlaced.sourceChain,
					BigInt(pointsToDeduct),
					ProtocolParticipantType.USER,
					PointsActivityType.ORDER_PLACED_POINTS,
					transactionHash,
					`Points deducted for refunded order ${commitment} with value ${orderPlaced.inputUSD} USD`,
					timestamp,
				)
			}
		}

		const orderStatusMetadata = await OrderStatusMetadata.create({
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

		await orderStatusMetadata.save()
	}

	static bytes32ToBytes20(bytes32: string): string {
		if (bytes32 === "0x0000000000000000000000000000000000000000000000000000000000000000") {
			return "0x0000000000000000000000000000000000000000"
		}

		const bytes = hexToBytes(bytes32 as Hex)
		const addressBytes = bytes.slice(12)
		return bytesToHex(addressBytes) as Hex
	}

	static computeOrderCommitment(order: Order): string {
		const encodedOrder = encodeAbiParameters(
			[
				{
					name: "order",
					type: "tuple",
					components: [
						{ name: "user", type: "bytes32" },
						{ name: "sourceChain", type: "bytes" },
						{ name: "destChain", type: "bytes" },
						{ name: "deadline", type: "uint256" },
						{ name: "nonce", type: "uint256" },
						{ name: "fees", type: "uint256" },
						{
							name: "outputs",
							type: "tuple[]",
							components: [
								{ name: "token", type: "bytes32" },
								{ name: "amount", type: "uint256" },
								{ name: "beneficiary", type: "bytes32" },
							],
						},
						{
							name: "inputs",
							type: "tuple[]",
							components: [
								{ name: "token", type: "bytes32" },
								{ name: "amount", type: "uint256" },
							],
						},
						{ name: "callData", type: "bytes" },
					],
				},
			],
			[
				{
					user: order.user as Hex,
					sourceChain: order.sourceChain as Hex,
					destChain: order.destChain as Hex,
					deadline: order.deadline,
					nonce: order.nonce,
					fees: order.fees,
					outputs: order.outputs.map((output) => ({
						token: output.token as Hex,
						amount: output.amount,
						beneficiary: output.beneficiary as Hex,
					})),
					inputs: order.inputs.map((input) => ({
						token: input.token as Hex,
						amount: input.amount,
					})),
					callData: order.callData as Hex,
				},
			],
		)

		return keccak256(encodedOrder)
	}
}
