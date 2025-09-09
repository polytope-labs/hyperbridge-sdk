import { Hex } from "viem"

export interface IGetRequest {
	// The source state machine of this request.
	source: string
	// The destination state machine of this request.
	dest: string
	// Module Id of the sending module
	from: Hex
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
	keys: Hex[]
	// Timestamp which this request expires in seconds.
	timeoutTimestamp: bigint
	context: Hex
}

export interface GetResponseStorageValues {
	key: Hex
	value: Hex
}

export interface IGetResponse {
	/**
	 * The request that triggered this response.
	 */
	get: IGetRequest
	/**
	 * The response message.
	 */
	values: GetResponseStorageValues[]
}

export interface IPostRequest {
	// The source state machine of this request.
	source: string
	// The destination state machine of this request.
	dest: string
	// Module Id of the sending module
	from: Hex
	// Module ID of the receiving module
	to: Hex
	// The nonce of this request on the source chain
	nonce: bigint
	// Encoded request body.
	body: Hex
	// Timestamp which this request expires in seconds.
	timeoutTimestamp: bigint
}

/**
 * Represents a dispatch post for cross-chain communication
 */
export interface DispatchPost {
	/**
	 * Bytes representation of the destination state machine
	 */
	dest: Hex

	/**
	 * The destination module
	 */
	to: Hex

	/**
	 * The request body
	 */
	body: Hex

	/**
	 * Timeout for this request in seconds
	 */
	timeout: bigint

	/**
	 * The amount put up to be paid to the relayer,
	 * this is charged in `IIsmpHost.feeToken` to `msg.sender`
	 */
	fee: bigint

	/**
	 * Who pays for this request?
	 */
	payer: Hex
}

export interface IPostResponse {
	// The request that triggered this response.
	post: IPostRequest
	// The response message.
	response: string
	// Timestamp at which this response expires in seconds.
	timeoutTimestamp: bigint
}
