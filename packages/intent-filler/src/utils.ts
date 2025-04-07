import { ethers } from "ethers"
import { Order } from "./types"
import { encodePacked, keccak256, toHex } from "viem"
import { UNISWAP_V2_ROUTER_ABI } from "./config/abis/UniswapV2Router"
import { ERC20_ABI } from "./config/abis/ERC20"

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"

export function getOrderCommitment(order: Order): string {
	let orderEncodePacked = encodePacked(
		[
			"bytes32",
			"bytes32",
			"bytes32",
			"uint256",
			"uint256",
			"uint256",
			"tuple(bytes32 token, uint256 amount, bytes32 beneficiary)[]",
			"tuple(bytes32 token, uint256 amount)[]",
			"bytes",
		],
		[
			order.user,
			toHex(order.sourceChain),
			toHex(order.destChain),
			order.deadline,
			order.nonce,
			order.fees,
			order.outputs,
			order.inputs,
			order.callData,
		],
	)
	return keccak256(orderEncodePacked)
}

export async function fetchTokenUsdPriceOnchain(
	tokenAddress: string,
	provider: ethers.providers.Provider,
	routerAddress: string, // Can be different for each chain
	wethAddress: string, // Can be different for each chain
	usdcAddress: string, // Can be different for each chain
): Promise<number> {
	try {
		const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, provider)
		const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
		const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider)

		const tokenDecimals = await tokenContract.decimals()
		const usdcDecimals = await usdcContract.decimals()

		let path: string[]

		// If the token is WETH, we can go directly to USDC
		if (tokenAddress.toLowerCase() === wethAddress.toLowerCase()) {
			path = [wethAddress, usdcAddress]
		} else {
			// Otherwise, we need to go through WETH to get to USDC
			path = [tokenAddress, wethAddress, usdcAddress]
		}

		// Amount of token to convert (1 token)
		const amountIn = ethers.utils.parseUnits("1", tokenDecimals)

		const amounts = await router.getAmountsOut(amountIn, path)

		// The last amount in the array is the output amount (in USDC)
		const usdcAmount = ethers.utils.formatUnits(amounts[amounts.length - 1], usdcDecimals)

		return parseFloat(usdcAmount)
	} catch (error) {
		console.error("Error fetching token price from Uniswap:", error)
		throw error
	}
}
