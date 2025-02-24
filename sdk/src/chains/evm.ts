import {
	bytesToBigInt,
	bytesToHex,
	createPublicClient,
	encodeFunctionData,
	hexToBytes,
	http,
	PublicClient,
	toHex,
} from "viem"
import {
	mainnet,
	arbitrum,
	arbitrumSepolia,
	optimism,
	optimismSepolia,
	base,
	baseSepolia,
	soneium,
	bsc,
	bscTestnet,
	gnosis,
	gnosisChiado,
} from "viem/chains"
import EvmHost from "../abis/evmHost"
import { IChain, IIsmpMessage } from "../chain"
import { HexString } from "@polytope-labs/hyperclient"
import { match } from "ts-pattern"
import HandlerV1 from "../abis/handler"

import { keccak256, toBytes, encodePacked, pad } from "viem"
import type { GetProofParameters, Hex } from "viem"
import flatten from "lodash/flatten"
import zip from "lodash/zip"
import {
	calculateMMRSize,
	EvmStateProof,
	isValidUTF8,
	mmrPositionToKIndex,
	MmrProof,
	SubstrateStateProof,
} from "../utils"

const chains = {
	[mainnet.id]: mainnet,
	[arbitrum.id]: arbitrum,
	[arbitrumSepolia.id]: arbitrumSepolia,
	[optimism.id]: optimism,
	[optimismSepolia.id]: optimismSepolia,
	[base.id]: base,
	[baseSepolia.id]: baseSepolia,
	[soneium.id]: soneium,
	[bsc.id]: bsc,
	[bscTestnet.id]: bscTestnet,
	[gnosis.id]: gnosis,
	[gnosisChiado.id]: gnosisChiado,
}

/**
 * Parameters for an EVM chain.
 */
export interface EvmChainParams {
	/**
	 * The chain ID of the EVM chain.
	 */
	chainId: number
	/**
	 * The host address of the EVM chain.
	 */
	host: HexString
	/**
	 * The URL of the EVM chain.
	 */
	url: string
}

/**
 * Encapsulates an EVM chain.
 */
export class EvmChain implements IChain {
	private publicClient: PublicClient

	constructor(private readonly params: EvmChainParams) {
		// @ts-ignore
		this.publicClient = createPublicClient({
			// @ts-ignore
			chain: chains[params.chainId],
			transport: http(params.url),
		})
	}

	/**
	 * Queries the proof of the requests.
	 * @param {HexString[]} requests - The requests to query.
	 * @param {string} counterparty - The counterparty address.
	 * @param {bigint} [at] - The block number to query at.
	 * @returns {Promise<HexString>} The proof.
	 */
	async queryRequestsProof(requests: HexString[], counterparty: string, at?: bigint): Promise<HexString> {
		const self = this
		// for each request derive the commitment key collect into a new array
		const commitmentKeys = requests.map(requestCommitmentKey)
		const config: GetProofParameters = {
			address: this.params.host,
			storageKeys: commitmentKeys,
		}
		if (!at) {
			config.blockTag = "latest"
		} else {
			config.blockNumber = at
		}
		const proof = await self.publicClient.getProof(config)
		const flattenedProof = Array.from(new Set(flatten(proof.storageProof.map((item) => item.proof))))

		const encoded = EvmStateProof.enc({
			contractProof: proof.accountProof.map((item) => Array.from(hexToBytes(item))),
			storageProof: [
				[Array.from(hexToBytes(self.params.host)), flattenedProof.map((item) => Array.from(hexToBytes(item)))],
			],
		})

		return toHex(encoded)
	}

	/**
	 * Returns the current timestamp of the chain.
	 * @returns {Promise<bigint>} The current timestamp.
	 */
	async timestamp(): Promise<bigint> {
		const data = await this.publicClient.readContract({
			address: this.params.host,
			abi: EvmHost.ABI,
			functionName: "timestamp",
		})
		return data
	}

	/**
	 * Encodes an ISMP message for the EVM chain.
	 * @param {IIsmpMessage} message The ISMP message to encode.
	 * @returns {HexString} The encoded calldata.
	 */
	encode(message: IIsmpMessage): HexString {
		const encoded = match(message)
			.with({ kind: "PostRequest" }, (request) => {
				const mmrProof = MmrProof.dec(request.proof.proof)
				const requests = zip(request.requests, mmrProof.leafIndexAndPos)
					.map(([req, leafIndexAndPos]) => {
						if (!req || !leafIndexAndPos) return
						const [[_pos, kIndex]] = mmrPositionToKIndex(
							[leafIndexAndPos?.pos],
							calculateMMRSize(mmrProof.leaf_count),
						)
						return {
							request: {
								source: toHex(req.source),
								dest: toHex(req.dest),
								to: req.to,
								from: req.from,
								nonce: req.nonce,
								timeoutTimestamp: req.timeoutTimestamp,
								body: req.body,
							} as any,
							index: leafIndexAndPos?.leaf_index!,
							kIndex,
						}
					})
					.filter((item) => !!item)

				const proof = {
					height: {
						stateMachineId: BigInt(parseInt(request.proof.stateMachine.split("-")[1])),
						height: request.proof.height,
					},
					multiproof: mmrProof.items.map((item) => bytesToHex(new Uint8Array(item))),
					leafCount: mmrProof.leaf_count,
				}
				const encoded = encodeFunctionData({
					abi: HandlerV1.ABI,
					functionName: "handlePostRequests",
					args: [
						this.params.host,
						{
							proof,
							requests,
						},
					],
				})

				return encoded
			})
			.with({ kind: "TimeoutPostRequest" }, (timeout) => {
				const proof = SubstrateStateProof.dec(timeout.proof.proof).value.storageProof.map((item) =>
					toHex(new Uint8Array(item)),
				)
				const encoded = encodeFunctionData({
					abi: HandlerV1.ABI,
					functionName: "handlePostRequestTimeouts",
					args: [
						this.params.host,
						{
							height: {
								stateMachineId: BigInt(parseInt(timeout.proof.stateMachine.split("-")[1])),
								height: timeout.proof.height,
							},
							timeouts: timeout.requests.map((req) => ({
								source: toHex(req.source),
								dest: toHex(req.dest),
								to: req.to,
								from: req.from,
								nonce: req.nonce,
								timeoutTimestamp: req.timeoutTimestamp,
								body: req.body,
							})),
							proof,
						},
					],
				})

				return encoded
			})
			.exhaustive()

		return encoded
	}
}

/**
 * Slot for storing request commitments.
 */
export const REQUEST_COMMITMENTS_SLOT = 0n

function requestCommitmentKey(key: Hex): Hex {
	// First derive the map key
	const keyBytes = hexToBytes(key)
	const mappedKey = deriveMapKey(keyBytes, REQUEST_COMMITMENTS_SLOT)

	// Convert the derived key to BigInt and add 1
	const number = bytesToBigInt(hexToBytes(mappedKey)) + 1n

	// Convert back to 32-byte hex
	return pad(`0x${number.toString(16)}`, { size: 32 })
}

function deriveMapKey(key: Uint8Array, slot: bigint): Hex {
	// Convert slot to 32-byte big-endian representation
	const slotBytes = pad(`0x${slot.toString(16)}`, { size: 32 })

	// Combine key and slot bytes
	const combined = new Uint8Array([...key, ...toBytes(slotBytes)])

	// Calculate keccak256 hash
	return keccak256(combined)
}
