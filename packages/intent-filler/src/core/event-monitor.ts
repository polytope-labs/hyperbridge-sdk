import { EventEmitter } from "events"
import { ethers } from "ethers"
import { ChainConfig, Order } from "@/types"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { getOrderCommitment } from "@/utils"

export class EventMonitor extends EventEmitter {
	private providers: Map<number, ethers.providers.Provider>
	private contracts: Map<number, ethers.Contract>
	private listening: boolean = false

	constructor(chainConfigs: ChainConfig[]) {
		super()
		this.providers = new Map()
		this.contracts = new Map()

		chainConfigs.forEach((config) => {
			const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl)
			this.providers.set(config.chainId, provider)

			const contract = new ethers.Contract(config.intentGatewayAddress, INTENT_GATEWAY_ABI, provider)
			this.contracts.set(config.chainId, contract)
		})
	}

	public startListening(): void {
		if (this.listening) return

		this.listening = true

		this.contracts.forEach((contract, chainId) => {
			contract.on("OrderPlaced", (event) => {
				const order = this.parseOrderEvent(event)
				const sourceProvider = this.providers.get(chainId)
				const destProvider = this.providers.get(chainId)
				this.emit("newOrder", { order, sourceProvider, destProvider })
			})
		})
	}

	public stopListening(): void {
		this.contracts.forEach((contract) => {
			contract.removeAllListeners("OrderPlaced")
		})
		this.listening = false
	}

	private parseOrderEvent(event: any): Order {
		const [user, sourceChain, destChain, deadline, nonce, fees, outputs, inputs, callData] = event.args
		const transactionHash = event.transactionHash

		return {
			id: getOrderCommitment({
				user,
				sourceChain,
				destChain,
				deadline,
				nonce,
				fees,
				outputs,
				inputs,
				callData,
			} as Order),
			user: user,
			sourceChain: sourceChain.toString(),
			destChain: destChain.toString(),
			deadline: deadline,
			nonce: nonce,
			fees: fees,
			outputs: outputs.map((output: any) => ({
				token: output.token.toString(),
				amount: output.amount.toString(),
				beneficiary: output.beneficiary.toString(),
			})),
			inputs: inputs.map((input: any) => ({
				token: input.token.toString(),
				amount: input.amount.toString(),
			})),
			callData: callData.toString(),
			transactionHash: transactionHash,
		}
	}
}
