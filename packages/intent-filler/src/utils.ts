import { parseUnits, PublicClient } from "viem"
import { UNISWAP_V2_ROUTER_ABI } from "./config/abis/UniswapV2Router"
import { ERC20_ABI } from "./config/abis/ERC20"
import { HexString } from "hyperbridge-sdk"

export async function fetchTokenUsdPriceOnchain(address: string): Promise<bigint> {
	return 1n
}
