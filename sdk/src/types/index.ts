import { HexString, IEvmConfig, IHyperbridgeConfig, ISubstrateConfig } from "@polytope-labs/hyperclient"

export interface ClientConfig {
	pollInterval?: number
	url?: string
	source: IEvmConfig | ISubstrateConfig
	dest: IEvmConfig | ISubstrateConfig
	hyperbridge: IHyperbridgeConfig
}

export interface RetryConfig {
	maxRetries: number
	backoffMs: number
}

export interface IsmpRequest {
	source: string
	dest: string
	from: string
	to: string
	nonce: bigint
	body: string
	timeoutTimestamp: bigint
	storage_key?: string
}

export enum RequestStatus {
	SOURCE = "SOURCE",
	SOURCE_FINALIZED = "SOURCE_FINALIZED",
	HYPERBRIDGE_DELIVERED = "HYPERBRIDGE_DELIVERED",
	HYPERBRIDGE_FINALIZED = "HYPERBRIDGE_FINALIZED",
	DESTINATION = "DESTINATION",
	TIMED_OUT = "TIMED_OUT",
	HYPERBRIDGE_TIMED_OUT = "HYPERBRIDGE_TIMED_OUT",
}

export enum HyperClientStatus {
	PENDING = "PENDING",
	SOURCE_FINALIZED = "SOURCE_FINALIZED",
	HYPERBRIDGE_FINALIZED = "HYPERBRIDGE_FINALIZED",
	HYPERBRIDGE_VERIFIED = "HYPERBRIDGE_VERIFIED",
	DESTINATION = "DESTINATION",
	TIMED_OUT = "TIMED_OUT",
	HYPERBRIDGE_TIMED_OUT = "HYPERBRIDGE_TIMED_OUT",
	ERROR = "ERROR",
}

export interface BlockMetadata {
	blockHash: string
	blockNumber: number
	transactionHash: string
	calldata?: string
}

export interface StatusResponse {
	status: RequestStatus | HyperClientStatus
	metadata?: Partial<BlockMetadata>
}

export interface StateMachineUpdate {
	height: number
	chain: string
	blockHash: string
	blockNumber: number
	transactionHash: string
	transactionIndex: number
	stateMachineId: string
	createdAt: string
}

export interface RequestResponse {
	requests: {
		nodes: Array<RequestWithStatus>
	}
}

export interface RequestWithStatus {
	source: string
	dest: string
	to: HexString
	from: HexString
	nonce: bigint
	body: HexString
	timeoutTimestamp: bigint
	statusMetadata: {
		nodes: Array<{
			blockHash: string
			blockNumber: string
			timestamp: string
			chain: string
			status: string
			transactionHash: string
		}>
	}
}

export interface RequestCommitment {
	requests: {
		nodes: Array<{
			id: string
			commitment: string
		}>
	}
}

export interface StateMachineResponse {
	stateMachineUpdateEvents: {
		nodes: StateMachineUpdate[]
	}
}
