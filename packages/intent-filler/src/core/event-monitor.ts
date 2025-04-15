import { EventEmitter } from "events"
import { ChainConfig, HexString, Order } from "@/types"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { DUMMY_PRIVATE_KEY, getOrderCommitment } from "@/utils"
import { PublicClient, decodeEventLog } from "viem"
import { addresses, chainIds } from "@/config/chain"
import { ChainClientManager } from "@/services"

export class EventMonitor extends EventEmitter {
	private clients: Map<number, PublicClient> = new Map()
	private listening: boolean = false
	private unwatchFunctions: Map<number, () => void> = new Map()
	private clientManager: ChainClientManager

	constructor(chainConfigs: ChainConfig[]) {
		super()

		this.clientManager = new ChainClientManager(DUMMY_PRIVATE_KEY)

		chainConfigs.forEach((config) => {
			const chainName = `EVM-${config.chainId}`
			const client = this.clientManager.getPublicClient(chainName)
			this.clients.set(config.chainId, client)
		})
	}

	public async startListening(): Promise<void> {
		if (this.listening) return
		this.listening = true

		for (const [chainId, client] of this.clients.entries()) {
			try {
				const orderPlacedEvent = INTENT_GATEWAY_ABI.find(
					(item) => item.type === "event" && item.name === "OrderPlaced",
				)

				const unwatch = client.watchEvent({
					address: addresses.IntentGateway[`EVM-${chainId}` as keyof typeof addresses.IntentGateway],
					event: orderPlacedEvent,
					onLogs: (logs) => {
						for (const log of logs) {
							try {
								const decodedLog = decodeEventLog({
									abi: INTENT_GATEWAY_ABI,
									data: log.data,
									topics: log.topics,
								})

								if (decodedLog.eventName !== "OrderPlaced") return

								const tempOrder: Order = {
									id: "",
									user: decodedLog.args.user as HexString,
									sourceChain: decodedLog.args.sourceChain,
									destChain: decodedLog.args.destChain,
									deadline: decodedLog.args.deadline,
									nonce: decodedLog.args.nonce,
									fees: decodedLog.args.fees,
									outputs: decodedLog.args.outputs.map((output) => ({
										token: output.token as HexString,
										amount: output.amount,
										beneficiary: output.beneficiary as HexString,
									})),
									inputs: decodedLog.args.inputs.map((input) => ({
										token: input.token as HexString,
										amount: input.amount,
									})),
									callData: decodedLog.args.callData as HexString,
									transactionHash: log.transactionHash as HexString,
								}

								const orderId = getOrderCommitment(tempOrder)

								const order: Order = {
									...tempOrder,
									id: orderId,
								}
								const sourceClient = client
								const destClient = this.clients.get(chainIds[order.destChain as keyof typeof chainIds])

								this.emit("newOrder", { chainId, order, sourceClient, destClient })
							} catch (error) {
								console.error(`Error parsing event log:`, error)
							}
						}
					},
					poll: true,
					pollingInterval: 1000,
				})
				this.unwatchFunctions.set(chainId, unwatch)

				console.log(`Started watching for OrderPlaced events on chain ${chainId}`)
			} catch (error) {
				console.error(`Failed to create event filter for chain ${chainId}:`, error)
			}
		}
	}

	public async stopListening(): Promise<void> {
		for (const [chainId, unwatch] of this.unwatchFunctions.entries()) {
			try {
				unwatch()
				console.log(`Stopped watching for events on chain ${chainId}`)
			} catch (error) {
				console.error(`Error stopping event watcher for chain ${chainId}:`, error)
			}
		}

		this.unwatchFunctions.clear()
		this.listening = false
	}
}
