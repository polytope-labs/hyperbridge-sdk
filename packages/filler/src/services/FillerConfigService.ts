import { toHex } from "viem"
import type { ChainConfig, HexString } from "@hyperbridge/sdk"
import { viemChains } from "@hyperbridge/sdk"

export interface FillerChainConfig {
	chainId: number
	rpcUrl: string
	intentGatewayAddress: string
	hostAddress?: string
	consensusStateId?: string
	coingeckoId?: string
	wrappedNativeDecimals?: number
	assets?: {
		WETH?: string
		DAI?: string
		USDC?: string
		USDT?: string
	}
	addresses?: {
		UniswapRouter02?: string
		UniswapV2Factory?: string
		BatchExecutor?: string
		UniversalRouter?: string
		UniswapV3Router?: string
		UniswapV3Factory?: string
		UniswapV3Quoter?: string
		UniswapV4PoolManager?: string
		UniswapV4Quoter?: string
	}
}

export interface HyperbridgeConfig {
	chainId: number
	rpcUrl: string
}

export interface CoinGeckoConfig {
	apiKey?: string
}

export interface FillerConfig {
	privateKey: string
	maxConcurrentOrders: number
	coingecko?: CoinGeckoConfig
}

/**
 * Custom configuration service for the filler that uses TOML configuration
 * instead of the SDK's environment-based configuration
 */
export class FillerConfigService {
	private chainConfigs: Map<number, FillerChainConfig> = new Map()
	private chainIdToStateMachineId: Map<number, string> = new Map()
	private hyperbridgeConfig?: HyperbridgeConfig
	private fillerConfig?: FillerConfig

	constructor(chainConfigs: FillerChainConfig[], hyperbridgeConfig?: HyperbridgeConfig, fillerConfig?: FillerConfig) {
		// Store chain configs by chain ID
		chainConfigs.forEach((config) => {
			this.chainConfigs.set(config.chainId, config)
			// Map chain ID to state machine ID format used by the SDK
			this.chainIdToStateMachineId.set(config.chainId, `EVM-${config.chainId}`)
		})

		this.hyperbridgeConfig = hyperbridgeConfig
		this.fillerConfig = fillerConfig
	}

	getChainConfig(chain: string): ChainConfig {
		// Extract chain ID from state machine ID format (EVM-97 -> 97)
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config) {
			throw new Error(`Chain configuration not found for chain: ${chain}`)
		}

		return {
			chainId: config.chainId,
			rpcUrl: config.rpcUrl,
			intentGatewayAddress: config.intentGatewayAddress as HexString,
		}
	}

	getIntentGatewayAddress(chain: string): `0x${string}` {
		const config = this.getChainConfig(chain)
		return config.intentGatewayAddress as `0x${string}`
	}

	getHostAddress(chain: string): `0x${string}` {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.hostAddress) {
			throw new Error(
				`Host address not configured for chain: ${chain}. Please add hostAddress to your TOML configuration.`,
			)
		}

		return config.hostAddress as `0x${string}`
	}

	getWrappedNativeAssetWithDecimals(chain: string): { asset: HexString; decimals: number } {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config) {
			throw new Error(`Chain configuration not found for chain: ${chain}`)
		}

		const wethAddress = config.assets?.WETH
		const decimals = config.wrappedNativeDecimals

		if (wethAddress && decimals !== undefined) {
			return {
				asset: wethAddress as HexString,
				decimals: decimals,
			}
		}

		// Fallback to viem chain configuration
		const viemChain = viemChains[chainId.toString()]
		if (!viemChain) {
			throw new Error(`Viem chain not found for chain ID: ${chainId}`)
		}

		return {
			asset: "0x0000000000000000000000000000000000000000" as HexString, // Native token
			decimals: viemChain.nativeCurrency.decimals,
		}
	}

	getDaiAsset(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.assets?.DAI) {
			throw new Error(
				`DAI asset address not configured for chain: ${chain}. Please add DAI address to your TOML configuration.`,
			)
		}

		return config.assets.DAI as HexString
	}

	getUsdtAsset(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.assets?.USDT) {
			throw new Error(
				`USDT asset address not configured for chain: ${chain}. Please add USDT address to your TOML configuration.`,
			)
		}

		return config.assets.USDT as HexString
	}

	getUsdcAsset(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.assets?.USDC) {
			throw new Error(
				`USDC asset address not configured for chain: ${chain}. Please add USDC address to your TOML configuration.`,
			)
		}

		return config.assets.USDC as HexString
	}

	getChainId(chain: string): number {
		return this.getChainIdFromStateMachineId(chain)
	}

	getConsensusStateId(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.consensusStateId) {
			throw new Error(
				`Consensus state ID not configured for chain: ${chain}. Please add consensusStateId to your TOML configuration.`,
			)
		}

		return toHex(config.consensusStateId)
	}

	getHyperbridgeChainId(): number {
		if (!this.hyperbridgeConfig?.chainId) {
			throw new Error(
				`Hyperbridge chain ID not configured. Please add hyperbridge configuration to your TOML configuration.`,
			)
		}

		return this.hyperbridgeConfig.chainId
	}

	getHyperbridgeRpcUrl(): string {
		if (!this.hyperbridgeConfig?.rpcUrl) {
			throw new Error(
				`Hyperbridge RPC URL not configured. Please add hyperbridge RPC URL to your TOML configuration.`,
			)
		}

		return this.hyperbridgeConfig.rpcUrl
	}

	getRpcUrl(chain: string): string {
		const config = this.getChainConfig(chain)
		return config.rpcUrl
	}

	getUniswapRouterV2Address(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapRouter02) {
			throw new Error(
				`Uniswap V2 Router address not configured for chain: ${chain}. Please add UniswapRouter02 address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapRouter02 as HexString
	}

	getUniswapV2FactoryAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapV2Factory) {
			throw new Error(
				`Uniswap V2 Factory address not configured for chain: ${chain}. Please add UniswapV2Factory address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapV2Factory as HexString
	}

	getBatchExecutorAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.BatchExecutor) {
			throw new Error(
				`BatchExecutor address not configured for chain: ${chain}. Please add BatchExecutor address to your TOML configuration.`,
			)
		}

		return config.addresses.BatchExecutor as HexString
	}

	getUniversalRouterAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniversalRouter) {
			throw new Error(
				`UniversalRouter address not configured for chain: ${chain}. Please add UniversalRouter address to your TOML configuration.`,
			)
		}

		return config.addresses.UniversalRouter as HexString
	}

	getUniswapV3RouterAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapV3Router) {
			throw new Error(
				`Uniswap V3 Router address not configured for chain: ${chain}. Please add UniswapV3Router address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapV3Router as HexString
	}

	getUniswapV3FactoryAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapV3Factory) {
			throw new Error(
				`Uniswap V3 Factory address not configured for chain: ${chain}. Please add UniswapV3Factory address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapV3Factory as HexString
	}

	getUniswapV3QuoterAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapV3Quoter) {
			throw new Error(
				`Uniswap V3 Quoter address not configured for chain: ${chain}. Please add UniswapV3Quoter address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapV3Quoter as HexString
	}

	getUniswapV4PoolManagerAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapV4PoolManager) {
			throw new Error(
				`Uniswap V4 PoolManager address not configured for chain: ${chain}. Please add UniswapV4PoolManager address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapV4PoolManager as HexString
	}

	getUniswapV4QuoterAddress(chain: string): HexString {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		if (!config?.addresses?.UniswapV4Quoter) {
			throw new Error(
				`Uniswap V4 Quoter address not configured for chain: ${chain}. Please add UniswapV4Quoter address to your TOML configuration.`,
			)
		}

		return config.addresses.UniswapV4Quoter as HexString
	}

	getCoingeckoId(chain: string): string | undefined {
		const chainId = this.getChainIdFromStateMachineId(chain)
		const config = this.chainConfigs.get(chainId)

		return config?.coingeckoId
	}

	getCoinGeckoApiKey(): string | undefined {
		return this.fillerConfig?.coingecko?.apiKey
	}

	private getChainIdFromStateMachineId(chain: string): number {
		// Handle both "EVM-97" format and direct chain ID
		if (chain.startsWith("EVM-")) {
			return Number.parseInt(chain.replace("EVM-", ""))
		}

		return parseInt(chain)
	}
}
