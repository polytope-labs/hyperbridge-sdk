import { chainIds } from "@/config/chain"
import { EventMonitor } from "./event-monitor"
import { FillerStrategy } from "@/strategies/base"
import { Order, FillerConfig, ChainConfig, DUMMY_PRIVATE_KEY } from "hyperbridge-sdk"
import pQueue from "p-queue"
import { ChainClientManager, ChainConfigService } from "@/services"
import { fetchTokenUsdPriceOnchain } from "@/utils"
import { PublicClient } from "viem"

export class IntentFiller {
	public monitor: EventMonitor
	private strategies: FillerStrategy[]
	private chainQueues: Map<number, pQueue>
	private globalQueue: pQueue
	private configService: ChainConfigService
	private chainClientManager: ChainClientManager
	private pendingOrders: Map<string, NodeJS.Timeout> = new Map()
	private orderRecheckCount: Map<string, number> = new Map()
	private config: FillerConfig

	constructor(chainConfigs: ChainConfig[], strategies: FillerStrategy[], config: FillerConfig) {
		this.monitor = new EventMonitor(chainConfigs)
		this.strategies = strategies
		this.config = config
		this.configService = new ChainConfigService()
		this.chainClientManager = new ChainClientManager(DUMMY_PRIVATE_KEY)

		this.chainQueues = new Map()
		chainConfigs.forEach((chainConfig) => {
			// 1 order per chain at a time due to EVM constraints

			this.chainQueues.set(chainConfig.chainId, new pQueue({ concurrency: 1 }))
		})

		this.globalQueue = new pQueue({
			concurrency: config.maxConcurrentOrders || 5,
		})

		// Set up event handlers
		this.monitor.on("newOrder", ({ order }) => {
			this.handleNewOrder(order)
		})
	}

	public start(): void {
		this.monitor.startListening()
	}

	public stop(): void {
		this.monitor.stopListening()

		// Clear all pending order timeouts
		this.pendingOrders.forEach((timeout) => clearTimeout(timeout))
		this.pendingOrders.clear()

		// Clear recheck counts
		this.orderRecheckCount.clear()

		// Wait for all queues to complete
		const promises = []
		this.chainQueues.forEach((queue) => {
			promises.push(queue.onIdle())
		})
		promises.push(this.globalQueue.onIdle())

		Promise.all(promises).then(() => {
			console.log("All orders processed, filler stopped")
		})
	}

	// Operations

	private handleNewOrder(order: Order): void {
		// Use the global queue for the initial analysis
		// This can happen in parallel for PublicClient orders
		this.globalQueue.add(async () => {
			try {
				// Check if the order has enough confirmations
				const hasEnoughConfirmations = await this.checkConfirmations(order)

				if (!hasEnoughConfirmations) {
					// If not enough confirmations, add to pending queue with a delay
					this.addToPendingQueue(order)
					return
				}

				// If we have enough confirmations, proceed with strategy evaluation
				this.evaluateAndExecuteOrder(order)
			} catch (error) {
				console.error(`Error processing order ${order.id}:`, error)
			}
		})
	}

	private async checkConfirmations(order: Order): Promise<boolean> {
		try {
			const sourceClient = this.chainClientManager.getPublicClient(order.sourceChain)
			const orderValue = await this.calculateOrderValue(order, sourceClient)
			const requiredConfirmations = this.config.confirmationPolicy.getConfirmationBlocks(
				chainIds[order.sourceChain as keyof typeof chainIds],
				orderValue,
			)

			const sourceReceipt = await sourceClient.getTransactionReceipt({ hash: order.transactionHash! })
			const sourceConfirmations = await sourceClient.getTransactionConfirmations({
				transactionReceipt: sourceReceipt,
			})

			console.log("sourceConfirmations", sourceConfirmations)
			console.log("requiredConfirmations", requiredConfirmations)

			if (sourceConfirmations < requiredConfirmations) {
				console.debug(
					`Insufficient confirmations for order ${order.id}, ${sourceConfirmations} confirmations, ${requiredConfirmations} required`,
				)
				return false
			}

			return true
		} catch (error) {
			console.error(`Error checking confirmations for order ${order.id}:`, error)
			return false
		}
	}

	private async calculateOrderValue(order: Order, client: PublicClient): Promise<bigint> {
		let totalUSDValue = BigInt(0)

		for (const input of order.inputs) {
			const tokenUsdPrice = await fetchTokenUsdPriceOnchain(input.token)

			totalUSDValue = totalUSDValue + BigInt(input.amount * BigInt(tokenUsdPrice))
		}

		return totalUSDValue
	}

	private addToPendingQueue(order: Order): void {
		if (this.pendingOrders.has(order.id!)) {
			clearTimeout(this.pendingOrders.get(order.id!)!)
			this.pendingOrders.delete(order.id!)
		}

		const currentRecheckCount = this.orderRecheckCount.get(order.id!) || 0
		const maxRechecks = this.config.pendingQueueConfig?.maxRechecks || 10

		// If we've exceeded the maximum number of rechecks, give up
		if (currentRecheckCount >= maxRechecks) {
			console.log(`Order ${order.id} has exceeded maximum recheck attempts (${maxRechecks}), giving up`)
			this.orderRecheckCount.delete(order.id!)
			return
		}

		this.orderRecheckCount.set(order.id!, currentRecheckCount + 1)

		// Get the configured delay or use default
		const recheckDelayMs = this.config.pendingQueueConfig?.recheckDelayMs || 30000

		// Set a timeout to recheck the order after a delay
		const timeout = setTimeout(async () => {
			console.log(
				`Rechecking order ${order.id} for confirmations (attempt ${currentRecheckCount + 1}/${maxRechecks})`,
			)

			// Check confirmations again
			const hasEnoughConfirmations = await this.checkConfirmations(order)

			if (hasEnoughConfirmations) {
				// If we now have enough confirmations, evaluate, execute and clear the maps
				this.evaluateAndExecuteOrder(order)
				this.orderRecheckCount.delete(order.id!)
				this.pendingOrders.delete(order.id!)
			} else {
				// If still not enough confirmations, add back to pending queue
				this.addToPendingQueue(order)
			}
		}, recheckDelayMs)

		this.pendingOrders.set(order.id!, timeout)
		console.log(`Added order ${order.id} to pending queue for confirmation check`)
	}

	private evaluateAndExecuteOrder(order: Order): void {
		this.globalQueue.add(async () => {
			try {
				const eligibleStrategies = await Promise.all(
					this.strategies.map(async (strategy) => {
						const canFill = await strategy.canFill(order)
						if (!canFill) return null

						const profitability = await strategy.calculateProfitability(order)
						return { strategy, profitability }
					}),
				)

				const validStrategies = eligibleStrategies
					.filter((s) => s !== null)
					.sort((a, b) => Number(b.profitability) - Number(a.profitability))

				if (validStrategies.length === 0) {
					console.log(`No viable strategy found for order ${order.id}`)
					return
				}

				// Get the chain-specific queue
				const chainQueue = this.chainQueues.get(chainIds[order.destChain as keyof typeof chainIds]!)
				if (!chainQueue) {
					console.error(`No queue configured for chain ${order.destChain}`)
					return
				}

				// Execute with the most profitable strategy using the chain-specific queue
				// This ensures transactions for the same chain are processed sequentially
				chainQueue.add(async () => {
					const bestStrategy = validStrategies[0].strategy
					console.log(
						`Executing order ${order.id} with strategy ${bestStrategy.name} on chain ${order.destChain}`,
					)

					try {
						const result = await bestStrategy.executeOrder(order)
						console.log(`Order execution result:`, result)
						return result
					} catch (error) {
						console.error(`Order execution failed:`, error)
						throw error
					}
				})
			} catch (error) {
				console.error(`Error processing order ${order.id}:`, error)
			}
		})
	}
}
