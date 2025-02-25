export type HexString = `0x${string}`

export interface IConfig {
	// confuration object for the source chain
	source: IEvmConfig | ISubstrateConfig
	// confuration object for the destination chain
	dest: IEvmConfig | ISubstrateConfig
	// confuration object for hyperbridge
	hyperbridge: IHyperbridgeConfig
	// Flag to enable tracing console logs
	tracing?: boolean
}

export interface IEvmConfig {
	// rpc url of the chain
	rpc_url: string
	// state machine identifier as a string
	state_machine: string
	// contract address of the `IsmpHost` on this chain
	host_address: string
	// consensus state identifier of this chain on hyperbridge
	consensus_state_id: string
}

export interface ISubstrateConfig {
	// rpc url of the chain
	rpc_url: string
	// consensus state identifier of this chain on hyperbridge
	consensus_state_id: string
	// consensus state identifier of this chain on hyperbridge
	hash_algo: "Keccak" | "Blake2"
	// state machine identifier as a string
	state_machine: string
}

export interface IHyperbridgeConfig {
	// websocket rpc endpoint for hyperbridge
	rpc_url: string
	// state machine identifier as a string
	state_machine: string
	// consensus state identifier of hyperbridge on the destination chain
	consensus_state_id: string
}

export interface IPostRequest {
	// The source state machine of this request.
	source: string
	// The destination state machine of this request.
	dest: string
	// Module Id of the sending module
	from: HexString
	// Module ID of the receiving module
	to: HexString
	// The nonce of this request on the source chain
	nonce: bigint
	// Encoded request body.
	body: HexString
	// Timestamp which this request expires in seconds.
	timeoutTimestamp: bigint
}

export interface IGetRequest {
	// The source state machine of this request.
	source: string
	// The destination state machine of this request.
	dest: string
	// Module Id of the sending module
	from: string
	// The nonce of this request on the source chain
	nonce: bigint
	// Height at which to read the state machine.
	height: bigint
	/// Raw Storage keys that would be used to fetch the values from the counterparty
	/// For deriving storage keys for ink contract fields follow the guide in the link below
	/// `<https://use.ink/datastructures/storage-in-metadata#a-full-example>`
	/// The algorithms for calculating raw storage keys for different substrate pallet storage
	/// types are described in the following links
	/// `<https://github.com/paritytech/substrate/blob/master/frame/support/src/storage/types/map.rs#L34-L42>`
	/// `<https://github.com/paritytech/substrate/blob/master/frame/support/src/storage/types/double_map.rs#L34-L44>`
	/// `<https://github.com/paritytech/substrate/blob/master/frame/support/src/storage/types/nmap.rs#L39-L48>`
	/// `<https://github.com/paritytech/substrate/blob/master/frame/support/src/storage/types/value.rs#L37>`
	/// For fetching keys from EVM contracts each key should be 52 bytes
	/// This should be a concatenation of contract address and slot hash
	keys: HexString[]
	// Timestamp which this request expires in seconds.
	timeoutTimestamp: bigint
}

export interface IPostResponse {
	// The request that triggered this response.
	post: IPostRequest
	// The response message.
	response: string
	// Timestamp at which this response expires in seconds.
	timeoutTimestamp: bigint
}

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
