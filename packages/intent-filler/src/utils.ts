import { ethers } from "ethers"
import { HexString, Order } from "./types"
import { encodePacked, keccak256, toHex, hexToBytes, pad, toBytes, bytesToBigInt, PublicClient } from "viem"
import { UNISWAP_V2_ROUTER_ABI } from "./config/abis/UniswapV2Router"
import { ERC20_ABI } from "./config/abis/ERC20"
import { generate_root, generate_proof } from "ckb-mmr-wasm/ckb_mmr_wasm"
import { IPostRequest } from "hyperbridge-sdk"
import { ScalePostRequest } from "hyperbridge-sdk"

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000" as HexString
export const DUMMY_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString

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

export function generateRootWithProof(postRequest: IPostRequest): { root: HexString; proof: HexString[] } {
	const encodedRequest = ScalePostRequest.enc({
		...postRequest,
		source: { tag: "Evm", value: Number.parseInt(postRequest.source.split("-")[1]) },
		dest: { tag: "Evm", value: Number.parseInt(postRequest.dest.split("-")[1]) },
		from: Array.from(hexToBytes(postRequest.from)),
		to: Array.from(hexToBytes(postRequest.to)),
		body: Array.from(hexToBytes(postRequest.body)),
	})
	const root = generate_root(new Uint8Array(encodedRequest)) as HexString
	const proof = generate_proof(new Uint8Array(encodedRequest)) as HexString[]
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
