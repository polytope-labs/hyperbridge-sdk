import { ApiPromise, WsProvider } from "@polkadot/api"
import { RpcWebSocketClient } from "rpc-websocket-client"
import { toHex, hexToBytes, toBytes, bytesToHex } from "viem"
import { match } from "ts-pattern"
import capitalize from "lodash/capitalize"
import { u8, Vector } from "scale-ts"

import { BasicProof, isEvmChain, isSubstrateChain, IStateMachine, Message, SubstrateStateProof } from "@/utils"
import { IChain, IIsmpMessage } from "@/chain"
import { HexString, IPostRequest } from "@/types"

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
	 * Returns the storage key for a request receipt in the child trie
	 * The request commitment is the key
	 * @param key - The H256 hash key (as a 0x-prefixed hex string)
	 * @returns The storage key as a hex string
	 */
	requestReceiptKey(key: HexString): HexString {
		const prefix = new TextEncoder().encode("RequestReceipts")

		const keyBytes = hexToBytes(key)

		// Concatenate the prefix and key bytes
		return bytesToHex(new Uint8Array([...prefix, ...keyBytes]))
	}

	/**
	 * Returns the storage key for a request commitment in the child trie
	 * The request commitment is the key
	 * @param key - The H256 hash key (as a 0x-prefixed hex string)
	 * @returns The storage key as a hex string
	 */
	requestCommitmentKey(key: HexString): HexString {
		const prefix = new TextEncoder().encode("RequestCommitments")

		const keyBytes = hexToBytes(key)

		// Concatenate the prefix and key bytes
		return bytesToHex(new Uint8Array([...prefix, ...keyBytes]))
	}

	/**
	 * Queries a request commitment from the ISMP child trie storage.
	 * @param {HexString} commitment - The commitment hash to look up.
	 * @returns {Promise<HexString | undefined>} The commitment data if found, undefined otherwise.
	 */
	async queryRequestCommitment(commitment: HexString): Promise<HexString | undefined> {
		const prefix = toHex(":child_storage:default:ISMP")
		const key = this.requestCommitmentKey(commitment)

		const rpc = new RpcWebSocketClient()
		await rpc.connect(this.params.ws)
		const item: any = await rpc.call("childstate_getStorage", [prefix, key])

		return item
	}

	/**
	 * Queries the request receipt.
	 * @param {HexString} commitment - The commitment to query.
	 * @returns {Promise<HexString | undefined>} The relayer address responsible for delivering the request.
	 */
	async queryRequestReceipt(commitment: HexString): Promise<HexString | undefined> {
		const prefix = toHex(":child_storage:default:ISMP")
		const key = this.requestReceiptKey(commitment)

		const rpc = new RpcWebSocketClient()
		await rpc.connect(this.params.ws)
		const item: any = await rpc.call("childstate_getStorage", [prefix, key])

		return item
	}

	/**
	 * Returns the current timestamp of the chain.
	 * @returns {Promise<bigint>} The current timestamp.
	 */
	async timestamp(): Promise<bigint> {
		if (!this.api) throw new Error("API not initialized")

		const now = await this.api.query.timestamp.now()
		return BigInt(now.toJSON() as number)
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
			// for substrate chains, we use the child trie proof
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
	 * Submit an unsigned ISMP transaction to the chain. Resolves when the transaction is finalized.
	 * @param message - The message to be submitted.
	 * @returns A promise that resolves to an object containing the transaction hash, block hash, and block number.
	 */
	async submitUnsigned(
		message: IIsmpMessage,
	): Promise<{ transactionHash: string; blockHash: string; blockNumber: number }> {
		const self = this
		if (!self.api) throw new Error("API not initialized")
		// remove the call and method selectors
		const args = hexToBytes(self.encode(message)).slice(2)
		const tx = self.api.tx.ismp.handleUnsigned(args)
		return new Promise(async (resolve, reject) => {
			const unsub = await tx.send(async ({ isFinalized, isError, dispatchError, txHash, status }) => {
				if (isFinalized) {
					unsub()
					const blockHash = status.asFinalized.toHex()
					const header = await self.api!.rpc.chain.getHeader(blockHash)
					resolve({
						transactionHash: txHash.toHex(),
						blockHash: blockHash,
						blockNumber: header.number.toNumber(),
					})
				} else if (isError) {
					unsub()
					console.error("Unsigned transaction failed: ", dispatchError)
					reject(dispatchError)
				}
			})
		})
	}

	/**
	 * Query the state proof for a given set of keys at a specific block height.
	 * @param at The block height to query the state proof at.
	 * @param keys The keys to query the state proof for.
	 * @returns The state proof as a hexadecimal string.
	 */
	async queryStateProof(at: bigint, keys: HexString[]): Promise<HexString> {
		const rpc = new RpcWebSocketClient()
		await rpc.connect(this.params.ws)
		const encodedKeys = keys.map((key) => Array.from(hexToBytes(key)))
		const proof: any = await rpc.call("ismp_queryChildTrieProof", [Number(at), encodedKeys])
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
							requests: message.requests.map((r) => convertIPostRequestToCodec(r)),
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
								requests: message.requests.map((r) => convertIPostRequestToCodec(r)),
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
	 * Returns the index of a pallet by its name, by looking up the pallets in the runtime metadata.
	 * @param {string} name - The name of the pallet.
	 * @returns {number} The index of the pallet.
	 */
	private getPalletIndex(name: string): number {
		if (!this.api) throw new Error("API not initialized")
		const pallets = this.api.runtimeMetadata.asLatest.pallets.entries()

		for (const p of pallets) {
			if (p[1].name.toString() === name) {
				const index = p[1].index.toNumber()

				return index
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
export function convertStateMachineIdToEnum(id: string): IStateMachine {
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
 * @param {IPostRequest} request - The array of IPostRequest objects.
 * @returns {any} The codec representation of the requests.
 */
function convertIPostRequestToCodec(request: IPostRequest): any {
	return {
		tag: "Post",
		value: {
			source: convertStateMachineIdToEnum(request.source),
			dest: convertStateMachineIdToEnum(request.dest),
			from: Array.from(hexToBytes(request.from)),
			to: Array.from(hexToBytes(request.to)),
			nonce: request.nonce,
			body: Array.from(hexToBytes(request.body)),
			timeoutTimestamp: request.timeoutTimestamp,
		},
	}
}
