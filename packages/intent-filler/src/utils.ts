import { PublicClient } from "viem"
import { UNISWAP_V2_ROUTER_ABI } from "./config/abis/UniswapV2Router"
import { ERC20_ABI } from "./config/abis/ERC20"
import { HexString } from "hyperbridge-sdk"

export async function fetchTokenUsdPriceOnchain(
	tokenAddress: string,
	client: PublicClient,
	routerAddress: string,
	wethAddress: string,
	usdcAddress: string,
): Promise<number> {
	try {
		const tokenDecimals = (await client.readContract({
			address: tokenAddress as HexString,
			abi: ERC20_ABI,
			functionName: "decimals",
		})) as number

		const usdcDecimals = (await client.readContract({
			address: usdcAddress as HexString,
			abi: ERC20_ABI,
			functionName: "decimals",
		})) as number

		let path: HexString[]

		// If the token is WETH, we can go directly to USDC
		if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
			path = [wethAddress as HexString, usdcAddress as HexString]
		} else {
			// Otherwise, we need to go through WETH to get to USDC
			path = [tokenAddress as HexString, wethAddress as HexString, usdcAddress as HexString]
		}

		// Amount of token to convert (1 token)
		const amountIn = BigInt(10 ** tokenDecimals)

		// Get amounts out using viem client
		const amounts = (await client.readContract({
			address: routerAddress as HexString,
			abi: UNISWAP_V2_ROUTER_ABI,
			functionName: "getAmountsOut",
			args: [amountIn, path],
		})) as bigint[]

		// The last amount in the array is the output amount (in USDC)
		const usdcAmount = Number(amounts[amounts.length - 1]) / 10 ** usdcDecimals

		return usdcAmount
	} catch (error) {
		console.error("Error fetching token price from Uniswap:", error)
		throw error
	}
}
