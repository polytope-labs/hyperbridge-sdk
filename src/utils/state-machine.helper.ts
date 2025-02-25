import { bytesToHex, PublicClient } from "viem"
import { blake2AsU8a, xxhashAsU8a } from "@polkadot/util-crypto"
import { u64, Struct, Option, Bytes, u8, Vector, Enum, u32 } from "scale-ts"
import type { ApiPromise } from "@polkadot/api"
import type { StorageData } from "@polkadot/types/interfaces"
import type { Option as PolkadotOption } from "@polkadot/types"
import { logger } from "ethers"
import { TextEncoder } from "util"
import { CHAINS_BY_ISMP_HOST } from "../constants"

// Define ConsensusStateId as 4-byte array
const ConsensusStateId = Vector(u8, 4)

// H256 is a 32-byte array
const H256 = Bytes(32)

// Define StateCommitment
const StateCommitment = Struct({
	timestamp: u64,
	overlay_root: Option(H256),
	state_root: H256,
})

// Define StateMachine
const StateMachine = Enum({
	Evm: u32,
	Polkadot: u32,
	Kusama: u32,
	Substrate: ConsensusStateId,
	Tendermint: ConsensusStateId,
})

// Define StateMachineId
const StateMachineId = Struct({
	state_id: StateMachine,
	consensus_state_id: ConsensusStateId,
})

// Define StateMachineHeight
const StateMachineHeight = Struct({
	id: StateMachineId,
	height: u64,
})

type StateMachineHeight = {
	id: {
		state_id:
			| { tag: "Evm"; value: number }
			| { tag: "Polkadot"; value: number }
			| { tag: "Kusama"; value: number }
			| { tag: "Substrate"; value: number[] }
			| { tag: "Tendermint"; value: number[] }
		consensus_state_id: number[]
	}
	height: bigint
}
type StateCommitment = {
	timestamp: bigint
	overlay_root: Uint8Array | undefined
	state_root: Uint8Array
}

export async function fetchStateCommitmentsSubstrate(params: {
	api: ApiPromise
	stateMachineId: string
	consensusStateId: string
	height: bigint
}): Promise<StateCommitment | null> {
	const { api, stateMachineId, consensusStateId, height } = params

	const state_machine_height: StateMachineHeight = {
		id: {
			state_id: getStateId(stateMachineId),
			consensus_state_id: Array.from(new TextEncoder().encode(consensusStateId)),
		},
		height: height,
	}

	logger.info(
		`Fetching state commitment for state machine height: ${JSON.stringify(state_machine_height, bigIntSerializer)}`,
	)

	const palletPrefix = xxhashAsU8a("Ismp", 128)
	const storagePrefix = xxhashAsU8a("StateCommitments", 128)

	const encodedStateMachineHeight = StateMachineHeight.enc(state_machine_height)
	const key = blake2AsU8a(encodedStateMachineHeight, 128)

	const full_key = new Uint8Array([...palletPrefix, ...storagePrefix, ...key, ...encodedStateMachineHeight])
	const hexKey = bytesToHex(full_key)

	const storage_value: PolkadotOption<StorageData> = (await api.rpc.state.getStorage(
		hexKey,
	)) as PolkadotOption<StorageData>

	if (storage_value.isSome) {
		return StateCommitment.dec(storage_value.value)
	}

	return null
}

export async function fetchStateCommitmentsEVM(params: {
	client: PublicClient
	stateMachineId: string
	consensusStateId: string
	height: bigint
}): Promise<StateCommitment | null> {
	const { client, stateMachineId, consensusStateId, height } = params

	const state_machine_height: StateMachineHeight = {
		id: {
			state_id: getStateId(stateMachineId),
			consensus_state_id: Array.from(new TextEncoder().encode(consensusStateId)),
		},
		height: height,
	}

	logger.info(
		`Fetching EVM state commitment for state machine height: ${JSON.stringify(state_machine_height, bigIntSerializer)}`,
	)

	const chainId = await client.getChainId()
	const hostContract = CHAINS_BY_ISMP_HOST[`EVM-${chainId}`]

	// Calculate storage slot using same encoding as substrate
	const encodedStateMachineHeight = StateMachineHeight.enc(state_machine_height)
	const key = blake2AsU8a(encodedStateMachineHeight, 128)

	const storageValue = await client.getStorageAt({
		address: hostContract,
		slot: bytesToHex(key),
	})

	if (!storageValue) {
		return null
	}

	const bytes = new Uint8Array(storageValue.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [])
	return StateCommitment.dec(bytes)
}

const bigIntSerializer = (key: string, value: any) => {
	if (typeof value === "bigint") {
		return value.toString()
	}
	return value
}

export const getStateMachineTag = (id: string): "Evm" | "Polkadot" | "Kusama" | "Substrate" | "Tendermint" => {
	switch (id) {
		case "EVM":
			return "Evm"
		case "POLKADOT":
			return "Polkadot"
		case "KUSAMA":
			return "Kusama"
		case "SUBSTRATE":
			return "Substrate"
		case "TENDERMINT":
			return "Tendermint"
		default:
			throw new Error(`Unknown state machine type: ${id}`)
	}
}

export const getStateId = (id: string) => {
	const [type, value] = id.split("-")
	const tag = getStateMachineTag(type)

	switch (tag) {
		case "Evm":
		case "Polkadot":
		case "Kusama":
			return {
				tag,
				value: Number(value),
			}
		case "Substrate":
		case "Tendermint":
			return {
				tag,
				value: Array.from(new TextEncoder().encode(value)),
			}
		default:
			throw new Error(`Unknown state machine type: ${type}`)
	}
}

export { StateMachineHeight, StateMachineId, StateMachine, StateCommitment }
