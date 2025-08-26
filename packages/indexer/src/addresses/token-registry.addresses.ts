/**
 * Token configuration interface.
 */
export interface TokenConfig {
	name: string
	symbol: string
	address?: string // Optional - zero address for native tokens
	updateFrequencySeconds: number
}

export const TOKEN_REGISTRY: TokenConfig[] = [
	// Native/Gas tokens
	{
		name: "ETH",
		symbol: "ETH",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Polkadot",
		symbol: "DOT",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Gnosis xDAI",
		symbol: "XDAI",
		updateFrequencySeconds: 600, // 10 minutes,
	},

	// Major stablecoins
	{
		name: "USD coin",
		symbol: "USDC",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Tether USD",
		symbol: "USDT",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Maker DAI",
		symbol: "DAI",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	// {
	// 	name: "USDH",
	// 	symbol: "USDH",
	// 	updateFrequencySeconds: 600, // 10 minutes,
	// },

	// Substrate tokens
	{
		name: "Bifrost",
		symbol: "BNC",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Cere Network",
		symbol: "CERE",
		updateFrequencySeconds: 600, // 10 minutes,
	},

	// Parachain tokens
	{
		name: "Moonbeam",
		symbol: "GLMR",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Astar",
		symbol: "ASTR",
		updateFrequencySeconds: 600, // 10 minutes,
	},

	// Voucher/Liquid staking tokens
	{
		name: "Voucher DOT",
		symbol: "vDOT",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Voucher BNC",
		symbol: "vBNC",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Bifrost Voucher ASTR",
		symbol: "vASTR",
		updateFrequencySeconds: 600, // 10 minutes,
	},
	{
		name: "Voucher GLMR",
		symbol: "vGLMR",
		updateFrequencySeconds: 600, // 10 minutes,
	},
]
