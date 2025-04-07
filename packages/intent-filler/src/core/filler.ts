import { EventMonitor } from "./event-monitor"
import { FillerStrategy } from "@/strategies/base"
import { Order, FillerConfig, ChainConfig } from "@/types"
import pQueue from "p-queue"

export class IntentFiller {
	private monitor: EventMonitor
	private strategies: FillerStrategy[]
	private config: FillerConfig
	private orderQueue: pQueue

	constructor(chainConfigs: ChainConfig[], strategies: FillerStrategy[], config: FillerConfig) {
		this.monitor = new EventMonitor(chainConfigs)
		this.strategies = strategies
		this.config = config

		// Create a concurrent queue for processing orders
		this.orderQueue = new pQueue({
			concurrency: config.maxConcurrentOrders || 5,
		})

		// Set up event handlers
		this.monitor.on("newOrder", ({ chainId, order }) => {
			this.handleNewOrder(order)
		})
	}

	public start(): void {
		this.monitor.startListening()
	}

	public stop(): void {
		this.monitor.stopListening()
		// Wait for pending orders to complete
		this.orderQueue.onIdle().then(() => {
			console.log("All orders processed, filler stopped")
		})
	}

	private handleNewOrder(order: Order): void {
		// Queue the order processing
		this.orderQueue.add(async () => {
			// Find the best strategy for this order
			const eligibleStrategies = await Promise.all(
				this.strategies.map(async (strategy) => {
					const canFill = await strategy.canFill(order, this.config)
					if (!canFill) return null

					const profitability = await strategy.calculateProfitability(order)
					return { strategy, profitability }
				}),
			)

			// Filter out null strategies and sort by profitability
			const validStrategies = eligibleStrategies
				.filter((s) => s !== null)
				.sort((a, b) => b.profitability - a.profitability)

			if (validStrategies.length === 0) {
				console.log(`No viable strategy found for order ${order.id}`)
				return
			}

			// Execute with the most profitable strategy
			const bestStrategy = validStrategies[0].strategy
			console.log(`Executing order ${order.id} with strategy ${bestStrategy.name}`)

			try {
				const result = await bestStrategy.executeOrder(order)
				console.log(`Order execution result:`, result)
			} catch (error) {
				console.error(`Order execution failed:`, error)
			}
		})
	}
}
