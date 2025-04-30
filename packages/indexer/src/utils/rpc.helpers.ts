import fetch from "node-fetch"
import { hexToBytes } from "viem"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { hexToU8a } from "@polkadot/util"

import { EVM_RPC_URL, SUBSTRATE_RPC_URL } from "@/constants"
import { replaceWebsocketWithHttp } from "@/handlers/events/substrateChains/handleRequestEvent.handler"

import { StateCommitment } from "./state-machine.helper"

/**
 * Get Block Timestamp is a function that retrieves the timestamp of a block given its hash and chain.
 * @param blockHash
 */
export async function getBlockTimestamp(blockhash: string, chain: string, storageKey = "0x00") {
	if (/evm/gi.test(chain)) {
		return getEvmBlockTimestamp(blockhash, chain)
	}

	return getSubstrateBlockTimestamp(storageKey, blockhash, chain)
}

interface ETHGetBlockByHashResponse {
	jsonrpc: "2.0"
	id: 1
	error?: {
		message: string
	}
	result: {
		milliTimestamp: bigint
		timestamp: bigint
		hash: `0x${string}`
	}
}

/**
 * Get EVM Block Timestamp is a function that retrieves the timestamp of a block given its hash and chain.
 * @param blockHash The hash of the block
 * @param chain The chain identifier
 * @returns The timestamp as a bigint
 * @throws Error if the RPC call fails or returns an invalid response
 */
export async function getEvmBlockTimestamp(blockHash: string, chain: string): Promise<bigint> {
	const rpcUrl = replaceWebsocketWithHttp(EVM_RPC_URL[chain])
	if (!rpcUrl) {
		throw new Error(`No RPC URL found for chain: ${chain}`)
	}

	const getBlockByHash = await fetch(rpcUrl, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({
			id: 1,
			jsonrpc: "2.0",
			method: "eth_getBlockByHash",
			params: [blockHash, false],
		}),
	})

	const block: ETHGetBlockByHashResponse = await getBlockByHash.json()

	// Check for JSON-RPC errors
	if (block.error) {
		throw new Error(`RPC error: ${block.error.message || JSON.stringify(block.error)}`)
	}

	// Validate the response contains a result with a timestamp
	if (!block.result || block.result.timestamp === undefined) {
		throw new Error(`Invalid response: No timestamp found in response ${JSON.stringify(block)}`)
	}

	return BigInt(block.result.timestamp)
}

interface StateGetStorageResponse {
	jsonrpc: "2.0"
	id: 1
	error?: {
		message: string
	}
	result: `0x${string}`
}

/**
 * Get Substrate Block Timestamp is a function that retrieves the timestamp of a block given its hash and chain.
 * @param storageKey The storage key for the state item
 * @param blockHash The hash of the block
 * @param chain The chain identifier
 * @returns The timestamp as a bigint
 * @throws Error if the RPC call fails or returns an invalid response
 */
export async function getSubstrateBlockTimestamp(
	storageKey: string,
	blockHash: string,
	chain: string,
): Promise<bigint> {
	const rpcUrl = replaceWebsocketWithHttp(SUBSTRATE_RPC_URL[chain])
	if (!rpcUrl) {
		throw new Error(`No RPC URL found for chain: ${chain}`)
	}

	const getStorageHash = await fetch(rpcUrl, {
		method: "POST",
		headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({
			id: 1,
			jsonrpc: "2.0",
			method: "state_getStorage",
			params: [storageKey, blockHash],
		}),
	})

	const storage: StateGetStorageResponse = await getStorageHash.json()

	if (storage.error) {
		throw new Error(`RPC error: ${storage.error.message || JSON.stringify(storage.error)}`)
	}

	if (!storage.result) {
		throw new Error(`Invalid response: No result found in response ${JSON.stringify(storage)}`)
	}

	const { timestamp } = StateCommitment.dec(hexToBytes(storage.result))

	return timestamp / 1000n
}

/**
 * Decode Timestamp Extrinsic to timestamp
 * @param timestampExtrinsic
 * @param chain
 * @returns number
 */
export async function DecodeTimestampExtrinsic(
	timestampExtrinsic: string,
	provider: WsProvider,
): Promise<number | undefined> {
	const api = await ApiPromise.create({ provider })

	const extrinsic = api.createType("Extrinsic", hexToU8a(timestampExtrinsic))
	console.log(`Decoded extrinsic: ${JSON.stringify(extrinsic)}`)

	const args = extrinsic.args

	const { method, section } = api.findCall(extrinsic.callIndex)
	if (section === "timestamp" && method === "set") {
		return Number(args[0].toHuman()?.toString().replace(/,/g, ""))
	}

	return undefined
}
