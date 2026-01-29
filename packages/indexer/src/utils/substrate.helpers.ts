import { SubstrateEvent } from "@subql/types"
import { CHAIN_IDS_BY_GENESIS, HYPERBRIDGE } from "@/constants"
import { StateMachineId } from "@/types/network.types"
import { hexToU8a, u8aToHex } from "@polkadot/util"
import { encodeAddress } from "@polkadot/util-crypto"

/**
 * Get the StateMachineID parsing the stringified object which substrate provides
 */
export const extractStateMachineIdFromSubstrateEventData = (substrateStateMachineId: string): string | undefined => {
	try {
		const parsed = JSON.parse(substrateStateMachineId)
		let stateId

		// Handle array format with direct objects
		if (Array.isArray(parsed)) {
			// Find the object containing stateId or ethereum/bsc keys
			const stateObject = parsed.find((item) => item?.stateId)

			if (!stateObject) return undefined

			// Extract stateId from different formats
			stateId = stateObject.stateId || stateObject
		} else {
			// Handle object format
			stateId = parsed.stateId
		}

		if (!stateId) {
			throw new Error(`StateId not present in stateMachineId: ${substrateStateMachineId}`)
		}

		// Extract key and value
		let main_key = ""
		let value = ""

		Object.entries(stateId).forEach(([key, val]) => {
			main_key = key.toUpperCase()
			value =
				val === null
					? ""
					: typeof val === "string" && val.startsWith("0x")
						? Buffer.from(val.slice(2), "hex").toString()
						: String(val)
		})

		switch (main_key) {
			case "EVM":
				return "EVM-".concat(value)
			case "POLKADOT":
				return "POLKADOT-".concat(value)
			case "KUSAMA":
				return "KUSAMA-".concat(value)
			case "SUBSTRATE":
				return "SUBSTRATE-".concat(value)
			case "TENDERMINT":
				return "TENDERMINT-".concat(value)
			default:
				throw new Error(
					`Unknown state machine ID ${main_key} encountered in extractStateMachineIdFromSubstrateEventData. `,
				)
		}
	} catch (error) {
		logger.error(error)
		return undefined
	}
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
 * Format chain data
 */

// TODO: Fix any type :(
export const formatChain = (chain: any): StateMachineId => {
	// Handle stringified JSON
	const chainObj = typeof chain === "string" ? JSON.parse(chain) : chain

	// Get the first key of the object (evm, substrate, etc)
	const chainType = Object.keys(chainObj)[0]
	if (chainType) {
		// Convert chainType to uppercase and combine with chain ID
		const rawChainId = chainObj[chainType]
		let id = String(rawChainId)
		if (typeof rawChainId === "string" && rawChainId.startsWith?.("0x")) {
			id = Buffer.from(rawChainId.slice(2), "hex").toString()
		}
		return `${chainType.toUpperCase()}-${id}` as StateMachineId
	}

	return chain
}

export function getHostStateMachine(chainId: string): StateMachineId {
	const host = CHAIN_IDS_BY_GENESIS[chainId]
	if (!host) {
		throw new Error(`Unknown genesis hash: ${chainId}`)
	}
	return host
}

export function isHyperbridge(host: StateMachineId): boolean {
	return host === HYPERBRIDGE.mainnet || host === HYPERBRIDGE.testnet || host === HYPERBRIDGE.local
}

/**
 * Error class for substrate indexing errors
 */
export class SubstrateIndexingError extends Error {
	constructor(
		message: string,
		public chainId: string,
		public blockNumber?: number,
		public eventMethod?: string,
	) {
		super(message)
		this.name = "SubstrateIndexingError"
	}
}

/**
 * Error class for state machine errors
 */
export class StateMachineError extends SubstrateIndexingError {
	constructor(message: string, chainId: string, blockNumber?: number) {
		super(message, chainId, blockNumber)
		this.name = "StateMachineError"
	}
}

/**
 * Error class for asset events
 */
export class AssetEventError extends SubstrateIndexingError {
	constructor(message: string, chainId: string, blockNumber?: number) {
		super(message, chainId, blockNumber)
		this.name = "AssetEventError"
	}
}

export class SubstrateEventValidator {
	/**
	 * Validate state machine event data
	 */
	static validateStateMachineEvent(event: SubstrateEvent): boolean {
		const { data, method } = event.event

		switch (method) {
			case "StateMachineUpdated":
				// Check data array exists and has required elements
				if (!Array.isArray(data) || data.length < 2) return false

				// Validate first element has stateId and consensusStateId
				const stateData = data[0].toJSON()
				if (
					typeof stateData !== "object" ||
					!stateData ||
					!("stateId" in stateData) ||
					!("consensusStateId" in stateData)
				)
					return false

				// Validate second element is a number (height)
				const height = Number(data[1].toString())
				return !isNaN(height)

			default:
				return false
		}
	}

	/**
	 * Validate chain metadata
	 */
	static validateChainMetadata(chainId: string, stateMachineId: string): boolean {
		return (
			typeof chainId === "string" &&
			chainId.length > 0 &&
			typeof stateMachineId === "string" &&
			stateMachineId.length > 0
		)
	}
}

export interface Get {
	get: {
		source: string
		dest: string
		nonce: number
		from: string
		keys: string[]
		height: number
		context: string
		timeoutTimestamp: number
	}
	values: {
		key: string
		value: string
	}[]
}

/**
 * Decodes a relayer address from potentially SCALE-encoded Signature bytes.
 *
 * The relayer field in Substrate events can be either:
 * 1. A raw 32-byte public key/address (for direct submissions)
 * 2. A SCALE-encoded Signature enum (when signed by relayer):
 *    - Evm { address: Vec<u8>, signature: Vec<u8> }      (variant 0)
 *    - Sr25519 { public_key: Vec<u8>, signature: Vec<u8> } (variant 1)
 *    - Ed25519 { public_key: Vec<u8>, signature: Vec<u8> } (variant 2)
 *
 * If the bytes are > 32 in length, it's a Signature that needs decoding.
 * The signer() method returns: address for Evm, public_key for Sr25519/Ed25519.
 *
 * @param relayerHex The hex-encoded relayer bytes from the event
 * @returns The decoded relayer address (SS58 for Substrate, hex for EVM)
 */
export function decodeRelayerAddress(relayerHex: string): string {
	const bytes = hexToU8a(relayerHex)

	if (bytes.length <= 32) {
		// Raw address bytes - encode as SS58
		return encodeAddress(relayerHex)
	}

	// SCALE-encoded Signature enum
	// First byte: variant index (0=Evm, 1=Sr25519, 2=Ed25519)
	const variantIndex = bytes[0]

	// Next byte(s): SCALE compact-encoded length of address/public_key
	let offset = 1
	const compactByte = bytes[offset]
	let fieldLength: number

	// SCALE compact encoding:
	// - If lower 2 bits are 00: single-byte mode, length = byte >> 2
	// - If lower 2 bits are 01: two-byte mode, length = ((byte2 << 6) | (byte1 >> 2))
	// - If lower 2 bits are 10: four-byte mode
	// - If lower 2 bits are 11: big-integer mode
	if ((compactByte & 0b11) === 0b00) {
		// Single-byte compact: length = byte >> 2
		fieldLength = compactByte >> 2
		offset += 1
	} else if ((compactByte & 0b11) === 0b01) {
		// Two-byte compact
		fieldLength = ((bytes[offset + 1] << 6) | (compactByte >> 2))
		offset += 2
	} else {
		// For larger lengths (unlikely for addresses)
		throw new Error(`Unsupported compact encoding in relayer signature: ${compactByte}`)
	}

	const signerBytes = bytes.slice(offset, offset + fieldLength)

	if (variantIndex === 0) {
		// Evm variant - return as hex address (typically 20 bytes)
		return u8aToHex(signerBytes)
	} else {
		// Sr25519 (1) or Ed25519 (2) - encode as SS58 address
		return encodeAddress(signerBytes)
	}
}
