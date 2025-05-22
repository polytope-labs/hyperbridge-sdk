import { EventEmitter } from "events"
import {
	ChainConfig,
	Order,
	orderCommitment,
	DUMMY_PRIVATE_KEY,
	hexToString,
	DecodedOrderPlacedLog,
} from "hyperbridge-sdk"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { PublicClient } from "viem"
import { addresses } from "@/config/chain"
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

				// const unwatch = client.watchEvent({
				// 	address: addresses.IntentGateway[`EVM-${chainId}` as keyof typeof addresses.IntentGateway],
				// 	event: orderPlacedEvent,
				// 	onLogs: (logs) => {
				// 		for (const log of logs) {
				// 			try {
				// 				const decodedLog = log as unknown as DecodedOrderPlacedLog
				// 				const tempOrder: Order = {
				// 					id: "",
				// 					user: decodedLog.args.user,
				// 					sourceChain: hexToString(decodedLog.args.sourceChain),
				// 					destChain: hexToString(decodedLog.args.destChain),
				// 					deadline: decodedLog.args.deadline,
				// 					nonce: decodedLog.args.nonce,
				// 					fees: decodedLog.args.fees,
				// 					outputs: decodedLog.args.outputs.map((output) => ({
				// 						token: output.token,
				// 						amount: output.amount,
				// 						beneficiary: output.beneficiary,
				// 					})),
				// 					inputs: decodedLog.args.inputs.map((input) => ({
				// 						token: input.token,
				// 						amount: input.amount,
				// 					})),
				// 					callData: decodedLog.args.callData,
				// 					transactionHash: decodedLog.transactionHash,
				// 				}

				// 				const orderId = orderCommitment(tempOrder)

				// 				const order: Order = {
				// 					...tempOrder,
				// 					id: orderId,
				// 				}

				// 				this.emit("newOrder", { order })
				// 			} catch (error) {
				// 				console.error(`Error parsing event log:`, error)
				// 			}
				// 		}
				// 	},
				// 	poll: true,
				// 	pollingInterval: 1000,
				// })
				// this.unwatchFunctions.set(chainId, unwatch)

				const order = {
					id: "0x2953c59554196377e6cfd1caa06820fce961669901b14154210666ad84d54597",
					user: "0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e",
					sourceChain: "EVM-10200",
					destChain: "EVM-97",
					deadline: 6533729700n,
					nonce: 38n,
					fees: 1000000n,
					outputs: [
						{
							token: "0x000000000000000000000000c043f483373072f7f27420d6e7d7ad269c018e18",
							amount: 1n,
							beneficiary: "0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e",
						},
					],
					inputs: [
						{
							token: "0x0000000000000000000000000000000000000000000000000000000000000000",
							amount: 100n,
						},
					],
					callData: "0x",
					transactionHash: "0x2217aed133420b8a8d958bdb91b3698bcae887dbf590d26fcc86513bded157b5",
				}

				this.emit("newOrder", { order })

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
