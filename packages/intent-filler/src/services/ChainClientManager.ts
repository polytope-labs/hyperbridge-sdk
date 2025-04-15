import { PublicClient, WalletClient } from "viem"
import { viemClientFactory } from "@/config/client"
import { ChainConfig, Order, HexString } from "@/types"
import { ChainConfigService } from "./ChainConfigService"

/**
 * Manages chain clients for different operations
 */
export class ChainClientManager {
	private privateKey: HexString
	private configService: ChainConfigService

	constructor(privateKey: HexString) {
		this.privateKey = privateKey
		this.configService = new ChainConfigService()
	}

	getPublicClient(chain: string): PublicClient {
		const config = this.configService.getChainConfig(chain)
		return viemClientFactory.getPublicClient(config)
	}

	getWalletClient(chain: string): WalletClient {
		const config = this.configService.getChainConfig(chain)
		return viemClientFactory.getWalletClient(config, this.privateKey)
	}

	getClientsForOrder(order: Order): {
		destClient: PublicClient
		sourceClient: PublicClient
		walletClient: WalletClient
	} {
		return {
			destClient: this.getPublicClient(order.destChain),
			sourceClient: this.getPublicClient(order.sourceChain),
			walletClient: this.getWalletClient(order.destChain),
		}
	}
}
