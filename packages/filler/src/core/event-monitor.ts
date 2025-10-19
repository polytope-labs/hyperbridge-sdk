import { EventEmitter } from "events"
import {
	ChainConfig,
	Order,
	orderCommitment,
	DUMMY_PRIVATE_KEY,
	hexToString,
	DecodedOrderPlacedLog,
} from "@hyperbridge/sdk"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { PublicClient } from "viem"
import { ChainClientManager } from "@/services"
import { FillerConfigService } from "@/services/FillerConfigService"
import { getLogger } from "@/services/Logger"

export class EventMonitor extends EventEmitter {
	private clients: Map<number, PublicClient> = new Map()
	private listening: boolean = false
	private unwatchFunctions: Map<number, () => void> = new Map()
	private clientManager: ChainClientManager
	private configService: FillerConfigService
	private logger = getLogger("event-monitor")
	private processedOrders: Map<string, { timestamp: number; blockNumber: bigint }> = new Map()
	private lastScannedBlock: Map<number, bigint> = new Map()
	private blockScanIntervals: Map<number, NodeJS.Timeout> = new Map()
	private readonly MAX_ORDER_HISTORY = 1000
	private readonly CLEANUP_INTERVAL = 3600000

	constructor(chainConfigs: ChainConfig[], configService: FillerConfigService, clientManager: ChainClientManager) {
		super()
		this.configService = configService
		this.clientManager = clientManager

		chainConfigs.forEach((config) => {
			const chainName = `EVM-${config.chainId}`
			const client = this.clientManager.getPublicClient(chainName)
			this.clients.set(config.chainId, client)
		})

		setInterval(() => this.cleanupOldOrders(), this.CLEANUP_INTERVAL)
	}

	private cleanupOldOrders(): void {
		const now = Date.now()
		const oneDayAgo = now - 86400000

		let cleaned = 0
		for (const [orderId, metadata] of this.processedOrders.entries()) {
			if (metadata.timestamp < oneDayAgo) {
				this.processedOrders.delete(orderId)
				cleaned++
			}
		}

		if (cleaned > 0) {
			this.logger.info({ cleaned, remaining: this.processedOrders.size }, "Cleaned up old orders")
		}

		if (this.processedOrders.size > this.MAX_ORDER_HISTORY) {
			const toDelete = this.processedOrders.size - this.MAX_ORDER_HISTORY
			const entries = Array.from(this.processedOrders.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)

			for (let i = 0; i < toDelete; i++) {
				this.processedOrders.delete(entries[i][0])
			}

			this.logger.warn({ deleted: toDelete }, "Enforced max order history limit")
		}
	}

	public async startListening(): Promise<void> {
		if (this.listening) return
		this.listening = true

		for (const [chainId, client] of this.clients.entries()) {
			try {
				const orderPlacedEvent = INTENT_GATEWAY_ABI.find(
					(item) => item.type === "event" && item.name === "OrderPlaced",
				)
				const intentGatewayAddress = this.configService.getIntentGatewayAddress(`EVM-${chainId}`)

				const startBlock = await client.getBlockNumber()
				this.lastScannedBlock.set(chainId, startBlock - 1n)

				this.logger.info({ chainId, startBlock }, "Starting event monitoring")

				// Dual approach: watchEvent + block scanner
				const unwatch = client.watchEvent({
					address: intentGatewayAddress,
					event: orderPlacedEvent,
					onLogs: (logs) => this.processLogs(logs),
					poll: true,
					pollingInterval: 500,
				})

				this.unwatchFunctions.set(chainId, unwatch)

				// Backup scanner with retry logic
				const scanInterval = setInterval(async () => {
					let retries = 3
					while (retries > 0) {
						try {
							await this.scanForMissedBlocks(chainId, client, intentGatewayAddress, orderPlacedEvent)
							break
						} catch (error) {
							retries--
							this.logger.warn(
								{ chainId, err: error, retriesLeft: retries },
								"Error in block scanner, retrying",
							)
							if (retries === 0) {
								this.logger.error({ chainId, err: error }, "Block scanner failed after retries")
							} else {
								await new Promise((resolve) => setTimeout(resolve, 1000))
							}
						}
					}
				}, 2000)

				this.blockScanIntervals.set(chainId, scanInterval)

				this.logger.info({ chainId }, "Started watching OrderPlaced events")
			} catch (error) {
				this.logger.error({ chainId, err: error }, "Failed to create event filter")
			}
		}
	}

	private async scanForMissedBlocks(
		chainId: number,
		client: PublicClient,
		intentGatewayAddress: `0x${string}`,
		orderPlacedEvent: any,
	): Promise<void> {
		const lastScanned = this.lastScannedBlock.get(chainId)
		if (!lastScanned) return

		const currentBlock = await client.getBlockNumber()

		if (currentBlock > lastScanned) {
			const fromBlock = lastScanned + 1n
			const toBlock = currentBlock

			const maxBlockRange = 1000n
			const actualToBlock = fromBlock + maxBlockRange > toBlock ? toBlock : fromBlock + maxBlockRange

			this.logger.debug(
				{ chainId, fromBlock, toBlock: actualToBlock, gap: Number(actualToBlock - fromBlock) },
				"Scanning for missed blocks",
			)

			const logs = await client.getLogs({
				address: intentGatewayAddress,
				event: orderPlacedEvent,
				fromBlock,
				toBlock: actualToBlock,
			})

			if (logs.length > 0) {
				this.logger.info(
					{ chainId, fromBlock, toBlock: actualToBlock, eventCount: logs.length },
					"Found events in block scan",
				)
				this.processLogs(logs)
			}

			this.lastScannedBlock.set(chainId, actualToBlock)
		}
	}

	private processLogs(logs: any[]): void {
		for (const log of logs) {
			try {
				const decodedLog = log as unknown as DecodedOrderPlacedLog
				const tempOrder: Order = {
					id: "",
					user: decodedLog.args.user,
					sourceChain: hexToString(decodedLog.args.sourceChain),
					destChain: hexToString(decodedLog.args.destChain),
					deadline: decodedLog.args.deadline,
					nonce: decodedLog.args.nonce,
					fees: decodedLog.args.fees,
					outputs: decodedLog.args.outputs.map((output) => ({
						token: output.token,
						amount: output.amount,
						beneficiary: output.beneficiary,
					})),
					inputs: decodedLog.args.inputs.map((input) => ({
						token: input.token,
						amount: input.amount,
					})),
					callData: decodedLog.args.callData,
					transactionHash: decodedLog.transactionHash,
				}
				const orderId = orderCommitment(tempOrder)

				// Duplicates
				if (this.processedOrders.has(orderId)) {
					this.logger.debug({ orderId }, "Skipping duplicate order")
					continue
				}

				this.processedOrders.set(orderId, {
					timestamp: Date.now(),
					blockNumber: decodedLog.blockNumber!,
				})

				const order: Order = { ...tempOrder, id: orderId }
				this.emit("newOrder", { order })
			} catch (error) {
				this.logger.error({ err: error, log }, "Error parsing event log")
			}
		}
	}

	public async stopListening(): Promise<void> {
		for (const [chainId, interval] of this.blockScanIntervals.entries()) {
			clearInterval(interval)
			this.logger.info({ chainId }, "Stopped block scanner")
		}
		this.blockScanIntervals.clear()

		for (const [chainId, unwatch] of this.unwatchFunctions.entries()) {
			try {
				unwatch()
				this.logger.info({ chainId }, "Stopped watching for events")
			} catch (error) {
				this.logger.error({ chainId, err: error }, "Error stopping event watcher")
			}
		}

		this.unwatchFunctions.clear()
		this.listening = false
		this.processedOrders.clear()
		this.lastScannedBlock.clear()
	}
}
