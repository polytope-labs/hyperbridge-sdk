// src/utils/viem-client.ts
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Chain } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { mainnet, gnosisChiado, bscTestnet } from "viem/chains"
import { ChainConfig } from "@/types"

// TODO: Merge this with chain.ts config file
const CHAINS: Record<string, Chain> = {
	"1": mainnet,
	"97": bscTestnet,
	"10200": gnosisChiado,
}

export class ViemClientFactory {
	private publicClients: Map<number, PublicClient> = new Map()
	private walletClients: Map<number, WalletClient> = new Map()

	public getPublicClient(chainConfig: ChainConfig): PublicClient {
		if (!this.publicClients.has(chainConfig.chainId)) {
			const chain = CHAINS[chainConfig.chainId]

			const publicClient = createPublicClient({
				chain,
				transport: http(chainConfig.rpcUrl, {
					timeout: 30000, // 30 seconds
					retryCount: 3,
					retryDelay: 1000,
				}),
			})

			this.publicClients.set(chainConfig.chainId, publicClient)
		}

		return this.publicClients.get(chainConfig.chainId)!
	}

	public getWalletClient(chainConfig: ChainConfig, privateKey: string): WalletClient {
		if (!this.walletClients.has(chainConfig.chainId)) {
			const chain = CHAINS[chainConfig.chainId]
			const account = privateKeyToAccount(privateKey as `0x${string}`)

			const walletClient = createWalletClient({
				chain,
				account,
				transport: http(chainConfig.rpcUrl, {
					timeout: 30000,
					retryCount: 3,
					retryDelay: 1000,
				}),
			})

			this.walletClients.set(chainConfig.chainId, walletClient)
		}

		return this.walletClients.get(chainConfig.chainId)!
	}
}

export const viemClientFactory = new ViemClientFactory()
