/**
 * Enum representing different chains.
 */
export enum Chains {
	BSC_CHAPEL = "EVM-97",
	GNOSIS_CHIADO = "EVM-10200",
}

import { Chain, bscTestnet, gnosisChiado } from "viem/chains"

type AddressMap = {
	[key: string]: {
		[K in Chains]?: `0x${string}`
	}
}

type RpcMap = {
	[K in Chains]?: string
}

/**
 * Mapping of chain IDs for different chains.
 */
export const chainIds = {
	[Chains.BSC_CHAPEL]: 97,
	[Chains.GNOSIS_CHIADO]: 10200,
} as const

export type ChainId = typeof chainIds

/**
 * Mapping of Viem Chain objects for different chains.
 */
export const viemChains: Record<string, Chain> = {
	"97": bscTestnet,
	"10200": gnosisChiado,
}

/**
 * Mapping of assets for different chains.
 */
export const assets = {
	[Chains.BSC_CHAPEL]: {
		WETH: "0x0000000000000000000000000000000000000000",
		DAI: "0x0000000000000000000000000000000000000000",
	},
}

/**
 * Mapping of addresses for different contracts.
 */
export const addresses: AddressMap = {
	UniswapV2Router: {
		[Chains.BSC_CHAPEL]: "0x0000000000000000000000000000000000000000",
		[Chains.GNOSIS_CHIADO]: "0x0000000000000000000000000000000000000000",
	},
	Handler: {
		[Chains.BSC_CHAPEL]: "0x0000000000000000000000000000000000000000",
		[Chains.GNOSIS_CHIADO]: "0x0000000000000000000000000000000000000000",
	},
	IntentGateway: {
		[Chains.BSC_CHAPEL]: "0x0000000000000000000000000000000000000000",
		[Chains.GNOSIS_CHIADO]: "0x0000000000000000000000000000000000000000",
	},
	Host: {
		[Chains.BSC_CHAPEL]: "0x0000000000000000000000000000000000000000",
		[Chains.GNOSIS_CHIADO]: "0x0000000000000000000000000000000000000000",
	},
}

export const rpcUrls = {
	[Chains.BSC_CHAPEL]: "https://bsc-rpc.publicnode.com",
	[Chains.GNOSIS_CHIADO]: "https://rpc.chiado.base.org",
}

export const consensusStateIds = {
	[Chains.BSC_CHAPEL]: "",
	[Chains.GNOSIS_CHIADO]: "GNO0",
}
