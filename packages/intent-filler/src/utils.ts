import { ethers } from "ethers"
import { HexString, Order } from "./types"
import { encodePacked, keccak256, toHex, hexToBytes, pad, toBytes, bytesToBigInt } from "viem"
import { UNISWAP_V2_ROUTER_ABI } from "./config/abis/UniswapV2Router"
import { ERC20_ABI } from "./config/abis/ERC20"
import { generate_root, generate_proof } from "ckb-mmr-wasm/ckb_mmr_wasm"
import { IPostRequest } from "hyperbridge-sdk"
import { ScalePostRequest } from "hyperbridge-sdk"

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

export function generateRootWithProof(postRequest: IPostRequest): { root: string; proof: string[] } {
	const encodedRequest = ScalePostRequest.enc({
		...postRequest,
		source: { tag: "Evm", value: Number.parseInt(postRequest.source.split("-")[1]) },
		dest: { tag: "Evm", value: Number.parseInt(postRequest.dest.split("-")[1]) },
		from: Array.from(hexToBytes(postRequest.from)),
		to: Array.from(hexToBytes(postRequest.to)),
		body: Array.from(hexToBytes(postRequest.body)),
	})
	const root = generate_root(new Uint8Array(encodedRequest))
	const proof = generate_proof(new Uint8Array(encodedRequest))
	return {
		root,
		proof,
	}
}

export const STATE_COMMITMENTS_SLOT = 5n

/**
 * Derives the storage slot for a specific field in the StateCommitment struct
 *
 * struct StateCommitment {
 *   uint256 timestamp;     // slot + 0
 *   bytes32 overlayRoot;   // slot + 1
 *   bytes32 stateRoot;     // slot + 2
 * }
 *
 * @param stateMachineId - The state machine ID
 * @param height - The block height
 * @param field - The field index in the struct (0 for timestamp, 1 for overlayRoot, 2 for stateRoot)
 * @returns The storage slot for the specific field
 */
export function getStateCommitmentFieldSlot(stateMachineId: bigint, height: bigint, field: 0 | 1 | 2): HexString {
	const baseSlot = getStateCommitmentSlot(stateMachineId, height)
	const slotNumber = bytesToBigInt(toBytes(baseSlot)) + BigInt(field)
	return pad(`0x${slotNumber.toString(16)}`, { size: 32 })
}

export function getStateCommitmentSlot(stateMachineId: bigint, height: bigint): HexString {
	// First level mapping: keccak256(stateMachineId . STATE_COMMITMENTS_SLOT)
	const firstLevelSlot = deriveFirstLevelSlot(stateMachineId, STATE_COMMITMENTS_SLOT)

	// Second level mapping: keccak256(height . firstLevelSlot)
	return deriveSecondLevelSlot(height, firstLevelSlot)
}

function deriveFirstLevelSlot(key: bigint, slot: bigint): HexString {
	const keyHex = pad(`0x${key.toString(16)}`, { size: 32 })
	const keyBytes = toBytes(keyHex)

	const slotBytes = toBytes(pad(`0x${slot.toString(16)}`, { size: 32 }))

	const combined = new Uint8Array([...keyBytes, ...slotBytes])

	return keccak256(combined)
}

function deriveSecondLevelSlot(key: bigint, firstLevelSlot: HexString): HexString {
	const keyHex = pad(`0x${key.toString(16)}`, { size: 32 })
	const keyBytes = toBytes(keyHex)

	const slotBytes = toBytes(firstLevelSlot)

	const combined = new Uint8Array([...keyBytes, ...slotBytes])

	return keccak256(combined)
}
