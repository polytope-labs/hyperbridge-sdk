import { chainIds } from "@/config/chain"
import { EventMonitor } from "./event-monitor"
import { FillerStrategy } from "@/strategies/base"
import { Order, FillerConfig, ChainConfig } from "@/types"
import pQueue from "p-queue"
import { ethers } from "ethers"
export class IntentFiller {
	private monitor: EventMonitor
	private strategies: FillerStrategy[]
	private config: FillerConfig
	private chainQueues: Map<number, pQueue>
	private globalQueue: pQueue

	constructor(chainConfigs: ChainConfig[], strategies: FillerStrategy[], config: FillerConfig) {
		this.monitor = new EventMonitor(chainConfigs)
		this.strategies = strategies
		this.config = config

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

	private handleNewOrder(order: Order): void {
		// Use the global queue for the initial analysis
		// This can happen in parallel for many orders
		this.globalQueue.add(async () => {
			try {
				const eligibleStrategies = await Promise.all(
					this.strategies.map(async (strategy) => {
						const canFill = await strategy.canFill(order, this.config)
						if (!canFill) return null

						const profitability = await strategy.calculateProfitability(order)
						return { strategy, profitability }
					}),
				)

				const validStrategies = eligibleStrategies
					.filter((s) => s !== null)
					.sort((a, b) => b.profitability - a.profitability)

				if (validStrategies.length === 0) {
					console.log(`No viable strategy found for order ${order.nonce}`)
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
						`Executing order ${order.nonce} with strategy ${bestStrategy.name} on chain ${order.destChain}`,
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
				console.error(`Error processing order ${order.nonce}:`, error)
			}
		})
	}
}
