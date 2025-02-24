import { HexString, IPostRequest } from "@polytope-labs/hyperclient"
import { ApiPromise, WsProvider } from "@polkadot/api"
import { RpcWebSocketClient } from "rpc-websocket-client"
import { toHex, hexToBytes, toBytes } from "viem"
import { match } from "ts-pattern"
import capitalize from "lodash/capitalize"
import { u8, Vector } from "scale-ts"

import { BasicProof, isEvmChain, isSubstrateChain, IStateMachine, Message, SubstrateStateProof } from "../utils"
import { IChain, IIsmpMessage } from "../chain"

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

	/**
	 * Encode an ISMP calldata for a substrate chain.
	 * @param message The ISMP message to encode.
	 * @returns The encoded message as a hexadecimal string.
	 */
	encode(message: IIsmpMessage): HexString {
		const palletIndex = this.getPalletIndex("Ismp")
		const args = match(message)
			.with({ kind: "PostRequest" }, (message) =>
				Vector(Message).enc([
					{
						tag: "RequestMessage",
						value: {
							proof: {
								height: {
									height: message.proof.height,
									id: {
										consensusStateId: Array.from(toBytes(message.proof.consensusStateId)),
										id: convertStateMachineIdToEnum(message.proof.stateMachine) as any,
									},
								},
								proof: Array.from(hexToBytes(message.proof.proof)),
							},
							signer: Array.from(hexToBytes(message.signer)),
							requests: convertIPostRequestToCodec(message.requests),
						},
					},
				]),
			)
			.with({ kind: "TimeoutPostRequest" }, (message) =>
				Vector(Message).enc([
					{
						tag: "TimeoutMessage",
						value: {
							tag: "Post",
							value: {
								requests: convertIPostRequestToCodec(message.requests),
								proof: {
									height: {
										height: message.proof.height,
										id: {
											consensusStateId: Array.from(toBytes(message.proof.consensusStateId)),
											id: convertStateMachineIdToEnum(message.proof.stateMachine) as any,
										},
									},
									proof: Array.from(hexToBytes(message.proof.proof)),
								},
							},
						},
					},
				]),
			)
			.exhaustive()

		// Encoding the call enum and call index
		const call = Vector(u8, 2).enc([palletIndex, 0])

		return toHex(new Uint8Array([...call, ...args]))
	}

	/**
	 * Returns the current timestamp of the chain.
	 * @returns {Promise<bigint>} The current timestamp.
	 */
	async timestamp(): Promise<bigint> {
		const now = await this.api?.query.timestamp.now()
		return BigInt(now?.toJSON() as number)
	}

	/**
	 * Returns the index of a pallet by its name, by looking up the pallets in the runtime metadata.
	 * @param {string} name - The name of the pallet.
	 * @returns {number} The index of the pallet.
	 */
	private getPalletIndex(name: string): number {
		const pallets = this.api!.runtimeMetadata.asLatest.pallets.entries()

		for (const p of pallets) {
			if (p[1].name.toString() === name) {
				const pallet_index = p[1].index.toNumber()

				return pallet_index
			}
		}

		throw new Error(`${name} not found in runtime`)
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

/**
 * Converts a state machine ID string to an enum value.
 * @param {string} id - The state machine ID string.
 * @returns {IStateMachine} The corresponding enum value.
 */
function convertStateMachineIdToEnum(id: string): IStateMachine {
	let [tag, value]: any = id.split("-")
	tag = capitalize(tag)
	if (["Evm", "Polkadot", "Kusama"].includes(tag)) {
		value = parseInt(value)
	} else {
		value = Array.from(toBytes(value))
	}

	return { tag, value }
}

/**
 * Converts an array of IPostRequest objects to a codec representation.
 * @param {IPostRequest[]} requests - The array of IPostRequest objects.
 * @returns {any} The codec representation of the requests.
 */
function convertIPostRequestToCodec(requests: IPostRequest[]): any {
	return {
		tag: "Post",
		value: {
			requests: requests.map((req) => ({
				source: convertStateMachineIdToEnum(req.source),
				dest: convertStateMachineIdToEnum(req.dest),
				from: Array.from(toBytes(req.from)),
				to: Array.from(toBytes(req.to)),
				nonce: req.nonce,
				body: Array.from(toBytes(req.body)),
				timeoutTimestamp: req.timeoutTimestamp,
			})) as any,
		},
	}
}
