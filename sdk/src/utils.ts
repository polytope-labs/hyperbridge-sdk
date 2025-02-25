import { HexString, IPostRequest } from "@/types"
import { encodePacked, keccak256, toHex } from "viem"

export * from "./utils/mmr"
export * from "./utils/substrate"

/**
 * Sleeps for the specified number of milliseconds.
 * @param ms The number of milliseconds to sleep.
 */
export function sleep(ms?: number) {
	return new Promise((resolve) => setTimeout(resolve, ms || 5_000))
}

/**
 * Checks if the given state machine ID represents an EVM chain.
 * @param stateMachineId The state machine ID to check.
 */
export function isEvmChain(stateMachineId: string): boolean {
	return stateMachineId.startsWith("EVM")
}

/**
 * Checks if the given state machine ID represents a Substrate chain.
 * @param stateMachineId The state machine ID to check.
 */
export function isSubstrateChain(stateMachineId: string): boolean {
	return (
		stateMachineId.startsWith("POLKADOT") ||
		stateMachineId.startsWith("KUSAMA") ||
		stateMachineId.startsWith("SUBSTRATE")
	)
}

/**
 * Checks if the given string is a valid UTF-8 string.
 * @param str The string to check.
 */
export function isValidUTF8(str: string): boolean {
	return Buffer.from(str).toString("utf8") === str
}

/**
 * Calculates the commitment hash for a post request.
 * @param post The post request to calculate the commitment hash for.
 * @returns The commitment hash.
 */
export function postRequestCommitment(post: IPostRequest): HexString {
	return keccak256(
		encodePacked(
			["bytes", "bytes", "uint64", "uint64", "bytes", "bytes", "bytes"],
			[toHex(post.source), toHex(post.dest), post.nonce, post.timeoutTimestamp, post.from, post.to, post.body],
		),
	)
}
