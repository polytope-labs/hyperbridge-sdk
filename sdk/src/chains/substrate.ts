import { HexString } from "@polytope-labs/hyperclient"
import { IChain, IIsmpMessage } from "../chain"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { BasicProof, isEvmChain, isSubstrateChain, SubstrateStateProof } from "../utils"
import { RpcWebSocketClient } from "rpc-websocket-client"
import { toHex, hexToBytes, encodeFunctionData } from "viem"
import { match, P } from "ts-pattern"

export interface SubstrateChainParams {
	/*
	 * ws: The WebSocket URL for the Substrate chain.
	 */
	ws: string

	/*
	 * hasher: The hashing algorithm used by the Substrate chain.
	 */
	hasher: "Keccak" | "Blake2"
}

export class SubstrateChain implements IChain {
	/*
	 * api: The Polkadot API instance for the Substrate chain.
	 */
	api?: ApiPromise
	constructor(private readonly params: SubstrateChainParams) {}

	/*
	 * connect: Connects to the Substrate chain using the provided WebSocket URL.
	 */
	public async connect() {
		const wsProvider = new WsProvider(this.params.ws)
		this.api = await ApiPromise.create({
			provider: wsProvider,
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
		const rpc = new RpcWebSocketClient()
		await rpc.connect(this.params.ws)
		if (isEvmChain(counterparty)) {
			// for evm chains, query the mmr proof
			const proof: any = await rpc.call("mmr_queryProof", [Number(at), { Requests: requests }])
			return toHex(proof.proof)
		} else if (isSubstrateChain(counterparty)) {
			const childTrieKeys = requests.map(requestCommitmentStorageKey)
			const proof: any = await rpc.call("ismp_queryChildTrieProof", [Number(at), childTrieKeys])
			const basicProof = BasicProof.dec(toHex(proof.proof))
			const encoded = SubstrateStateProof.enc({
				tag: "OverlayProof",
				value: {
					hasher: {
						tag: this.params.hasher,
						value: undefined,
					},
					storageProof: basicProof,
				},
			})
			return toHex(encoded)
		} else {
			throw new Error(`Unsupported chain type for counterparty: ${counterparty}`)
		}
	}

	encode(message: IIsmpMessage): HexString {
		// match(message).with({ kind: "PostRequest" }, (message) => {
		// 	encodeFunctionData({})
		// })
		//
		// todo:
		return "0x"
	}

	/**
	 * Returns the current timestamp of the chain.
	 * @returns {Promise<bigint>} The current timestamp.
	 */
	async timestamp(): Promise<bigint> {
		const now = await this.api?.query.timestamp.now()
		return BigInt(now?.toJSON() as number)
	}
}

function requestCommitmentStorageKey(key: HexString): number[] {
	// Convert "RequestCommitments" to bytes
	const prefix = new TextEncoder().encode("RequestCommitments")

	// Convert hex key to bytes
	const keyBytes = hexToBytes(key)

	// Combine prefix and key bytes
	return Array.from(new Uint8Array([...prefix, ...keyBytes]))
}
