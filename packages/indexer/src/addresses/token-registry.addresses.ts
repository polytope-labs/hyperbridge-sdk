/**
 * Token configuration interface
 */
export interface TokenConfig {
	name: string
	symbol: string
	address?: string // Optional - zero address for native tokens
	decimals: number
	updateFrequencySeconds: number
}

/**
 * Update frequencies for different token types
 */
export enum PriceUpdateFrequency {
	HIGH = 120, // 2 minutes for major tokens (ETH, USDC, etc.)
	MEDIUM = 300, // 5 minutes for common tokens
	LOW = 1800, // 30 minutes for less common tokens
}

export const TOKEN_REGISTRY: TokenConfig[] = [
	// Native/Gas tokens
	{
		name: "ETH",
		symbol: "ETH",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.HIGH,
	},
	{
		name: "Polkadot",
		symbol: "DOT",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.HIGH,
	},
	{
		name: "Gnosis xDAI",
		symbol: "XDAI",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.HIGH,
	},

	// Major stablecoins
	{
		name: "USD coin",
		symbol: "USDC",
		decimals: 6,
		updateFrequencySeconds: PriceUpdateFrequency.LOW,
	},
	{
		name: "Tether USD",
		symbol: "USDT",
		decimals: 6,
		updateFrequencySeconds: PriceUpdateFrequency.LOW,
	},
	{
		name: "Maker DAI",
		symbol: "DAI",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.LOW,
	},
	// {
	// 	name: "USDH",
	// 	symbol: "USDH",
	// 	decimals: 6,
	// },

	// Substrate tokens
	{
		name: "Bifrost",
		symbol: "BNC",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
	{
		name: "Cere Network",
		symbol: "CERE",
		decimals: 10,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
	{
		name: "Cere Network",
		symbol: "CERE",
		decimals: 10,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},

	// Parachain tokens
	{
		name: "Moonbeam",
		symbol: "GLMR",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
	{
		name: "Astar",
		symbol: "ASTR",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},

	// Voucher/Liquid staking tokens
	{
		name: "Voucher DOT",
		symbol: "vDOT",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
	{
		name: "Voucher BNC",
		symbol: "vBNC",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
	{
		name: "Bifrost Voucher ASTR",
		symbol: "vASTR",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
	{
		name: "Voucher GLMR",
		symbol: "vGLMR",
		decimals: 18,
		updateFrequencySeconds: PriceUpdateFrequency.MEDIUM,
	},
]
