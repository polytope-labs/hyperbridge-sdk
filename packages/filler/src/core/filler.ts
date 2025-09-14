import { chainIds } from "@hyperbridge/sdk"
import { EventMonitor } from "./event-monitor"
import { FillerStrategy } from "@/strategies/base"
import { Order, FillerConfig, ChainConfig, DUMMY_PRIVATE_KEY, ADDRESS_ZERO, bytes20ToBytes32 } from "@hyperbridge/sdk"
import pQueue from "p-queue"
import { ChainClientManager, ContractInteractionService } from "@/services"
import { FillerConfigService } from "@/services/FillerConfigService"

import { PublicClient } from "viem"
import { generatePrivateKey } from "viem/accounts"

export class IntentFiller {
	public monitor: EventMonitor
	private strategies: FillerStrategy[]
	private chainQueues: Map<number, pQueue>
	private globalQueue: pQueue
	private chainClientManager: ChainClientManager
	private contractService: ContractInteractionService
	private config: FillerConfig
	private configService: FillerConfigService

	constructor(
		chainConfigs: ChainConfig[],
		strategies: FillerStrategy[],
		config: FillerConfig,
		configService: FillerConfigService,
	) {
		this.configService = configService
		this.monitor = new EventMonitor(chainConfigs, configService)
		this.strategies = strategies
		this.config = config
		this.chainClientManager = new ChainClientManager(configService)
		this.contractService = new ContractInteractionService(
			this.chainClientManager,
			generatePrivateKey(),
			configService,
		)
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

	// Operations

	private handleNewOrder(order: Order): void {
		// Use the global queue for the initial analysis
		// This can happen in parallel for PublicClient orders
		this.globalQueue.add(async () => {
			console.log("📦 New order detected:", order)
			try {
				const sourceClient = this.chainClientManager.getPublicClient(order.sourceChain)
				const orderValue = await this.contractService.getTokenUsdValue(order)
				let currentConfirmations = await sourceClient.getTransactionConfirmations({
					hash: order.transactionHash!,
				})
				const requiredConfirmations = this.config.confirmationPolicy.getConfirmationBlocks(
					chainIds[order.sourceChain as keyof typeof chainIds],
					orderValue.inputUsdValue,
				)
				console.log(
					`For order ${order.id}, required confirmations: ${requiredConfirmations},
					current confirmations: ${currentConfirmations}`,
				)

				while (currentConfirmations < requiredConfirmations) {
					await new Promise((resolve) => setTimeout(resolve, 300)) // Wait 300ms
					currentConfirmations = await sourceClient.getTransactionConfirmations({
						hash: order.transactionHash!,
					})
					console.log(`Order ${order.id} current confirmations: ${currentConfirmations}`)
				}

				console.log(`Order ${order.id} confirmed on source chain: ${currentConfirmations}`)

				this.evaluateAndExecuteOrder(order)
			} catch (error) {
				console.error(`Error processing order ${order.id}:`, error)
			}
		})
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
					.filter((s): s is NonNullable<typeof s> => s !== null && s.profitability > 0n)
					.sort((a, b) => Number(b.profitability) - Number(a.profitability))

				if (validStrategies.length === 0) {
					console.log(`No profitable strategy found for order ${order.id}`)
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
						if (result.success) {
							this.monitor.emit("orderFilled", { orderId: order.id, hash: result.txHash })
						}
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
