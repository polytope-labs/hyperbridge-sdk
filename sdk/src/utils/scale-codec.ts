import { Struct, Vector, u8, u64, Tuple, Enum, _void } from "scale-ts"

export const H256 = Vector(u8, 32)

export const EvmStateProof = Struct({
	/**
	 * Proof of the contract state.
	 */
	contractProof: Vector(Vector(u8)),
	/**
	 * Proof of the storage state.
	 */
	storageProof: Vector(Tuple(Vector(u8), Vector(Vector(u8)))),
})

export const SubstrateHashing = Enum({
	/* For chains that use keccak as their hashing algo */
	Keccak: _void,
	/* For chains that use blake2b as their hashing algo */
	Blake2: _void,
})

export const SubstrateStateMachineProof = Struct({
	/**
	 * The hasher used to hash the state machine state.
	 */
	hasher: SubstrateHashing,
	/**
	 * Proof of the state machine state.
	 */
	storageProof: Vector(Vector(u8)),
})

export const SubstrateStateProof = Enum({
	/*
	 * Uses overlay root for verification
	 */
	OverlayProof: SubstrateStateMachineProof,
	/*
	 * Uses state root for verification
	 */
	StateProof: SubstrateStateMachineProof,
})

export const BasicProof = Vector(Vector(u8))

export const LeafIndexAndPos = Struct({
	/*
	 * Leaf index
	 */
	leaf_index: u64,
	/*
	 * Leaf position in the MMR
	 */
	pos: u64,
})

export const MmrProof = Struct({
	/*
	 * Proof of the leaf index and position.
	 */
	leafIndexAndPos: Vector(LeafIndexAndPos),
	/*
	 * Proof of the leaf data.
	 */
	leaf_count: u64,
	/*
	 * Proof elements (hashes of siblings of inner nodes on the path to the leaf).
	 */
	items: Vector(H256),
})
