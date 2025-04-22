/**
 * Enum representing different chains.
 */
export enum Chains {
	BSC_CHAPEL = "EVM-97",
	GNOSIS_CHIADO = "EVM-10200",
	HYPERBRIDGE_GARGANTUA = "KUSAMA-4009",
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
	[Chains.HYPERBRIDGE_GARGANTUA]: 4009,
} as const

export type ChainId = typeof chainIds

/**
 * Mapping of Viem Chain objects for different chains.
 */
export const viemChains: Record<string, Chain> = {
	"97": bscTestnet,
	"10200": gnosisChiado,
}

export const WrappedNativeDecimals = {
	[Chains.BSC_CHAPEL]: 18,
	[Chains.GNOSIS_CHIADO]: 18,
}

/**
 * Mapping of assets for different chains.
 */
export const assets = {
	[Chains.BSC_CHAPEL]: {
		WETH: "0xb8c77482e45f1f44de1745f52c74426c631bdd52",
		DAI: "0x0000000000000000000000000000000000000000",
	},
	[Chains.GNOSIS_CHIADO]: {
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
		[Chains.BSC_CHAPEL]: "0x4638945E120846366cB7Abc08DB9c0766E3a663F",
		[Chains.GNOSIS_CHIADO]: "0x4638945E120846366cB7Abc08DB9c0766E3a663F",
	},
	IntentGateway: {
		[Chains.BSC_CHAPEL]: "0x81b9d21be1D94975d35d1c4b7C6e9347cE571aad",
		[Chains.GNOSIS_CHIADO]: "0x81b9d21be1D94975d35d1c4b7C6e9347cE571aad",
	},
	Host: {
		[Chains.BSC_CHAPEL]: "0x8Aa0Dea6D675d785A882967Bf38183f6117C09b7",
		[Chains.GNOSIS_CHIADO]: "0x58a41b89f4871725e5d898d98ef4bf917601c5eb",
	},
	FeeToken: {
		[Chains.BSC_CHAPEL]: "0xA801da100bF16D07F668F4A49E1f71fc54D05177",
		[Chains.GNOSIS_CHIADO]: "0xA801da100bF16D07F668F4A49E1f71fc54D05177",
	},
}

export const rpcUrls = {
	[Chains.BSC_CHAPEL]: process.env.BSC_CHAPEL || "",
	[Chains.GNOSIS_CHIADO]: process.env.GNOSIS_CHIADO || "",
	[Chains.HYPERBRIDGE_GARGANTUA]: process.env.HYPERBRIDGE_GARGANTUA || "",
}

export const consensusStateIds = {
	[Chains.BSC_CHAPEL]: "BSC0",
	[Chains.GNOSIS_CHIADO]: "GNO0",
	[Chains.HYPERBRIDGE_GARGANTUA]: "PAS0",
}
