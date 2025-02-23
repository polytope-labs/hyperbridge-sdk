export interface ClientConfig {
	pollInterval?: number
	url?: string
	hyperbridgeStateMachineId: string
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
	timestamp: bigint
	chain: string
	transactionHash: string
	status: HyperClientStatus | RequestStatus
	callData?: string
}

export interface StatusResponse {
	status: RequestStatus | HyperClientStatus
	metadata: Partial<BlockMetadata>
	message?: string
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
	to: string
	from: string
	nonce: bigint
	body: string
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
