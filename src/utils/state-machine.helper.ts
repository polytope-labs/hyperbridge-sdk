import { bytesToBigInt, bytesToHex, hexToBytes, keccak256, pad, PublicClient, toBytes, toHex } from "viem"
import { blake2AsU8a, xxhashAsU8a } from "@polkadot/util-crypto"
import { u64, Struct, Option, Bytes, u8, Vector, Enum, u32 } from "scale-ts"
import type { ApiPromise } from "@polkadot/api"
import type { StorageData } from "@polkadot/types/interfaces"
import { Option as PolkadotOption } from "@polkadot/types"
import { logger } from "ethers"
import { TextEncoder } from "util"
import { CHAINS_BY_ISMP_HOST } from "../constants"
import { Codec } from "@polkadot/types/types"

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

	const storage_value: PolkadotOption<Codec> = (await api.rpc.state.getStorage(hexKey)) as PolkadotOption<Codec>

	if (storage_value.isSome) {
		// Convert to bytes regardless of input type
		const bytes = storage_value.value.toU8a()

		return StateCommitment.dec(bytes)
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

	// Add check for Kusama or Polkadot state machine type
	const stateIdType = state_machine_height.id.state_id.tag
	if (stateIdType !== "Kusama" && stateIdType !== "Polkadot") {
		logger.info(`Unknown State Machine: ${stateIdType}. Expected Polkadot or Kusama state machine`)
		return null
	}

	const chainId = await client.getChainId()
	const hostContract = CHAINS_BY_ISMP_HOST[`EVM-${chainId}`]

	// Extract the paraId from the state machine ID
	const paraId = BigInt(state_machine_height.id.state_id.value)

	// Generate keys for timestamp, overlay, and state root
	const [timestampKey, overlayKey, stateRootKey] = generateStateCommitmentKeys(paraId, height)

	// Query the three storage values
	const timestampValue = await client.getStorageAt({
		address: hostContract,
		slot: bytesToHex(timestampKey),
	})

	if (!timestampValue) {
		return null
	}

	const overlayRootValue = await client.getStorageAt({
		address: hostContract,
		slot: bytesToHex(overlayKey),
	})

	const stateRootValue = await client.getStorageAt({
		address: hostContract,
		slot: bytesToHex(stateRootKey),
	})

	// Parse timestamp from big-endian bytes to BigInt
	const timestampBytes = hexToBytes(timestampValue)
	const timestamp = bytesToBigInt(timestampBytes)

	// Create the StateCommitment object
	return {
		timestamp,
		overlay_root: overlayRootValue ? hexToBytes(overlayRootValue) : undefined,
		state_root: stateRootValue ? hexToBytes(stateRootValue) : new Uint8Array(),
	}
}

function generateStateCommitmentKeys(paraId: bigint, height: bigint): [Uint8Array, Uint8Array, Uint8Array] {
	// Constants
	const STATE_COMMITMENT_SLOT = 5n

	// Convert to bytes using viem utilities
	const stateIdBytes = toBytes(pad(`0x${paraId.toString(16)}`, { size: 32 }))
	const slotBytes = toBytes(pad(`0x${STATE_COMMITMENT_SLOT.toString(16)}`, { size: 32 }))

	// Generate parent map key
	const parentMapKeyData = concatBytes(stateIdBytes, slotBytes)
	const parentMapKey = hexToBytes(keccak256(toHex(parentMapKeyData)))

	// Generate commitment key
	const heightBytes = toBytes(pad(`0x${height.toString(16)}`, { size: 32 }))
	const commitmentKeyData = concatBytes(heightBytes, parentMapKey)

	// Generate base slot
	const baseSlotHash = keccak256(toHex(commitmentKeyData))
	const baseSlot = hexToBytes(baseSlotHash)

	// Calculate overlay and state root slots
	const baseSlotBigInt = bytesToBigInt(baseSlot)
	const overlaySlot = hexToBytes(pad(`0x${(baseSlotBigInt + 1n).toString(16)}`, { size: 32 }))
	const stateRootSlot = hexToBytes(pad(`0x${(baseSlotBigInt + 2n).toString(16)}`, { size: 32 }))

	return [baseSlot, overlaySlot, stateRootSlot]
}

// Helper function to concatenate Uint8Arrays
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
	const result = new Uint8Array(totalLength)
	let offset = 0
	for (const arr of arrays) {
		result.set(arr, offset)
		offset += arr.length
	}
	return result
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
