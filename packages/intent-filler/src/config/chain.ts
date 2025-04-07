/**
 * Enum representing different chains.
 */
export enum Chains {
	BSC_CHAPEL = "bscChapel",
	GNOSIS_CHIADO = "gnosisChiado",
}

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
export const chainId = {
	[Chains.BSC_CHAPEL]: 97,
	[Chains.GNOSIS_CHIADO]: 10200,
} as const

export type ChainId = typeof chainId

/**
 * Mapping of assets for different chains.
 */
export const assets = {
	[Chains.BSC_CHAPEL]: {
		WETH: "0x0000000000000000000000000000000000000000",
		USDC: "0x0000000000000000000000000000000000000000",
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
}
