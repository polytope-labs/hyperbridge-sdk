import { EventEmitter } from "events"
import { ethers } from "ethers"
import { ChainConfig, Order } from "@/types"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { getOrderCommitment } from "@/utils"

export class EventMonitor extends EventEmitter {
	private providers: Map<string, ethers.providers.Provider>
	private contracts: Map<string, ethers.Contract>
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
			contract.on("OrderPlaced", (...args) => {
				const order = this.parseOrderEvent(args)
				this.emit("newOrder", { chainId, order })
			})
		})
	}

	public stopListening(): void {
		this.contracts.forEach((contract) => {
			contract.removeAllListeners("OrderPlaced")
		})
		this.listening = false
	}

	private parseOrderEvent(eventArgs: any[]): Order {
		const [user, sourceChain, destChain, deadline, nonce, fees, outputs, inputs, callData] = eventArgs

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
		}
	}
}
