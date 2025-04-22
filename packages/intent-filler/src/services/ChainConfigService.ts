import { toHex } from "viem"
import { ChainConfig, HexString } from "hyperbridge-sdk"
import { addresses, assets, rpcUrls, chainIds, consensusStateIds, Chains, WrappedNativeDecimals } from "@/config/chain"

/**
 * Centralizes access to chain configuration
 */
export class ChainConfigService {
	/**
	 * Gets the chain configuration for a given chain
	 */
	getChainConfig(chain: string): ChainConfig {
		return {
			chainId: chainIds[chain as keyof typeof chainIds],
			rpcUrl: rpcUrls[chain as keyof typeof chainIds],
			intentGatewayAddress: addresses.IntentGateway[chain as keyof typeof chainIds]!,
		}
	}

	/**
	 * Gets the IntentGateway address for a given chain
	 */
	getIntentGatewayAddress(chain: string): `0x${string}` {
		return addresses.IntentGateway[chain as keyof typeof addresses.IntentGateway]! as `0x${string}`
	}

	/**
	 * Gets the Host address for a given chain
	 */
	getHostAddress(chain: string): `0x${string}` {
		return addresses.Host[chain as keyof typeof addresses.Host]! as `0x${string}`
	}

	/**
	 * Gets the Handler address for a given chain
	 */
	getHandlerAddress(chain: string): HexString {
		return addresses.Handler[chain as keyof typeof addresses.Handler]!
	}

	/**
	 * Gets the UniswapV2Router address for a given chain
	 */
	getUniswapV2RouterAddress(chain: string): HexString {
		return addresses.UniswapV2Router[chain as keyof typeof addresses.UniswapV2Router]!
	}

	/**
	 * Gets the Native asset for a given chain
	 */
	getWrappedNativeAssetWithDecimals(chain: string): { asset: HexString; decimals: number } {
		return {
			asset: assets[chain as keyof typeof assets].WETH as HexString,
			decimals: WrappedNativeDecimals[chain as keyof typeof WrappedNativeDecimals],
		}
	}

	/**
	 * Gets the DAI asset for a given chain
	 */
	getDaiAsset(chain: string): HexString {
		return assets[chain as keyof typeof assets].DAI as HexString
	}

	/**
	 * Gets the chain ID for a given chain
	 */
	getChainId(chain: string): number {
		return chainIds[chain as keyof typeof chainIds]
	}

	/**
	 * Gets the consensus state ID for a given chain
	 */
	getConsensusStateId(chain: string): HexString {
		return toHex(consensusStateIds[chain as keyof typeof consensusStateIds])
	}

	/**
	 * Gets the FeeToken address for a given chain
	 */
	getFeeTokenAddress(chain: string): HexString {
		return addresses.FeeToken[chain as keyof typeof addresses.FeeToken]!
	}

	/**
	 * Gets the Hyperbridge Gargantua chain ID
	 */
	getHyperbridgeChainId(): number {
		return chainIds[Chains.HYPERBRIDGE_GARGANTUA]
	}
}
