import { EventEmitter } from "events"
import { ChainConfig, HexString, Order, orderCommitment, DUMMY_PRIVATE_KEY } from "hyperbridge-sdk"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { PublicClient, decodeEventLog, Log, Hex } from "viem"
import { addresses, chainIds } from "@/config/chain"
import { ChainClientManager } from "@/services"

function hexToString(hex: string): string {
	const hexWithoutPrefix = hex.startsWith("0x") ? hex.slice(2) : hex

	const bytes = new Uint8Array(hexWithoutPrefix.length / 2)
	for (let i = 0; i < hexWithoutPrefix.length; i += 2) {
		bytes[i / 2] = parseInt(hexWithoutPrefix.slice(i, i + 2), 16)
	}

	return new TextDecoder().decode(bytes)
}

interface DecodedLog extends Log {
	eventName: string
	args: {
		user: HexString
		sourceChain: Hex
		destChain: Hex
		deadline: bigint
		nonce: bigint
		fees: bigint
		outputs: Array<{
			token: HexString
			amount: bigint
			beneficiary: HexString
		}>
		inputs: Array<{
			token: HexString
			amount: bigint
		}>
		callData: HexString
	}
	transactionHash: HexString
}

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

	// public async startListening(): Promise<void> {
	// 	if (this.listening) return
	// 	this.listening = true

	// 	for (const [chainId, client] of this.clients.entries()) {
	// 		try {
	// 			const orderPlacedEvent = INTENT_GATEWAY_ABI.find(
	// 				(item) => item.type === "event" && item.name === "OrderPlaced",
	// 			)

	// 			const unwatch = client.watchEvent({
	// 				address: addresses.IntentGateway[`EVM-${chainId}` as keyof typeof addresses.IntentGateway],
	// 				event: orderPlacedEvent,
	// 				onLogs: (logs) => {
	// 					console.log("Received logs:", logs)
	// 					for (const log of logs) {
	// 						try {
	// 							const decodedLog = log as unknown as DecodedLog
	// 							const tempOrder: Order = {
	// 								id: "",
	// 								user: decodedLog.args.user,
	// 								sourceChain: hexToString(decodedLog.args.sourceChain),
	// 								destChain: hexToString(decodedLog.args.destChain),
	// 								deadline: decodedLog.args.deadline,
	// 								nonce: decodedLog.args.nonce,
	// 								fees: decodedLog.args.fees,
	// 								outputs: decodedLog.args.outputs.map((output) => ({
	// 									token: output.token,
	// 									amount: output.amount,
	// 									beneficiary: output.beneficiary,
	// 								})),
	// 								inputs: decodedLog.args.inputs.map((input) => ({
	// 									token: input.token,
	// 									amount: input.amount,
	// 								})),
	// 								callData: decodedLog.args.callData,
	// 								transactionHash: decodedLog.transactionHash,
	// 							}

	// 							console.log("tempOrder", tempOrder)

	// 							const orderId = orderCommitment(tempOrder)
	// 							console.log("orderId", orderId)

	// 							const order: Order = {
	// 								...tempOrder,
	// 								id: orderId,
	// 							}
	// 							console.log("order", order)

	// 							this.emit("newOrder", { order })
	// 						} catch (error) {
	// 							console.error(`Error parsing event log:`, error)
	// 						}
	// 					}
	// 				},
	// 				poll: true,
	// 				pollingInterval: 1000,
	// 			})
	// 			this.unwatchFunctions.set(chainId, unwatch)

	// 			console.log(`Started watching for OrderPlaced events on chain ${chainId}`)
	// 		} catch (error) {
	// 			console.error(`Failed to create event filter for chain ${chainId}:`, error)
	// 		}
	// 	}
	// }

	public async startListening(): Promise<void> {
		if (this.listening) return
		this.listening = true

		const order: Order = {
			id: "0xb1c61a5bcaee83ace0961c97a7e4295f54ea0eb220de7edcaea8dd880193f22d",
			user: "0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e",
			sourceChain: "EVM-97",
			destChain: "EVM-10200",
			deadline: 65337297n,
			nonce: 6n,
			fees: 1000000n,
			outputs: [
				{
					token: "0x0000000000000000000000000000000000000000000000000000000000000000",
					amount: 100n,
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
			transactionHash: "0xdde9f155350218a1e8622eff9e553092aa43c9cb4fbb5fa39559e22fefe33ea3",
		}

		this.emit("newOrder", { order })
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
