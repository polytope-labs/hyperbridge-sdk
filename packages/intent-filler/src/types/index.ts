export type HexString = `0x${string}`

/**
 * Configuration for a blockchain chain
 */
export interface ChainConfig {
	/**
	 * The unique identifier for the chain
	 */
	chainId: number

	/**
	 * The RPC URL to connect to the chain
	 */
	rpcUrl: string

	/**
	 * The address of the IntentGateway contract on this chain
	 */
	intentGatewayAddress: string
}

/**
 * Represents token information for an order
 */
export interface TokenInfo {
	/**
	 * The address of the ERC20 token
	 * address(0) is used as a sentinel for the native token
	 */
	token: HexString

	/**
	 * The amount of the token
	 */
	amount: bigint
}

/**
 * Represents payment information for an order
 */
export interface PaymentInfo extends TokenInfo {
	/**
	 * The address to receive the output tokens
	 */
	beneficiary: HexString
}

/**
 * Represents an order in the IntentGateway
 */
export interface Order {
	/**
	 * The unique identifier for the order
	 */
	id: string

	/**
	 * The address of the user who is initiating the transfer
	 */
	user: HexString

	/**
	 * The state machine identifier of the origin chain
	 */
	sourceChain: HexString

	/**
	 * The state machine identifier of the destination chain
	 */
	destChain: HexString

	/**
	 * The block number by which the order must be filled on the destination chain
	 */
	deadline: bigint

	/**
	 * The nonce of the order
	 */
	nonce: bigint

	/**
	 * Represents the dispatch fees associated with the IntentGateway
	 */
	fees: bigint

	/**
	 * The tokens that the filler will provide
	 */
	outputs: PaymentInfo[]

	/**
	 * The tokens that are escrowed for the filler
	 */
	inputs: TokenInfo[]

	/**
	 * A bytes array to store the calls if any
	 */
	callData: HexString

	// Additional Data
	/**
	 * The transaction hash of the order
	 */
	transactionHash: HexString
}

/**
 * Options for filling an order
 */
export interface FillOptions {
	/**
	 * The fee paid to the relayer for processing transactions
	 */
	relayerFee: string
}

/**
 * Options for canceling an order
 */
export interface CancelOptions {
	/**
	 * The fee paid to the relayer for processing transactions
	 */
	relayerFee: string

	/**
	 * Stores the height value
	 */
	height: string
}

/**
 * Represents a new deployment of IntentGateway
 */
export interface NewDeployment {
	/**
	 * Identifier for the state machine
	 */
	stateMachineId: HexString

	/**
	 * The gateway identifier
	 */
	gateway: HexString
}

/**
 * Represents the body of a request
 */
export interface RequestBody {
	/**
	 * Represents the commitment of an order
	 */
	commitment: HexString

	/**
	 * Stores the identifier for the beneficiary
	 */
	beneficiary: HexString

	/**
	 * An array of token identifiers
	 */
	tokens: TokenInfo[]
}

/**
 * Represents the parameters for the IntentGateway module
 */
export interface Params {
	/**
	 * The address of the host contract
	 */
	host: string

	/**
	 * Address of the dispatcher contract responsible for handling intents
	 */
	dispatcher: string
}

/**
 * Enum representing the different kinds of incoming requests
 */
export enum RequestKind {
	/**
	 * Identifies a request for redeeming an escrow
	 */
	RedeemEscrow = 0,

	/**
	 * Identifies a request for recording new contract deployments
	 */
	NewDeployment = 1,

	/**
	 * Identifies a request for updating parameters
	 */
	UpdateParams = 2,
}

/**
 * Configuration for the IntentFiller
 */
export interface FillerConfig {
	/**
	 * Policy for determining confirmation requirements
	 */
	confirmationPolicy: {
		getConfirmationBlocks: (chainId: number, amount: string) => number
	}

	/**
	 * Maximum number of orders to process concurrently
	 */
	maxConcurrentOrders?: number

	/**
	 * Minimum profitability threshold to consider filling an order
	 * Expressed as a percentage (e.g., 0.5 = 0.5%)
	 */
	minProfitabilityThreshold?: number

	/**
	 * Gas price strategy for each chain
	 * Maps chainId to a gas price strategy function
	 */
	gasPriceStrategy?: Record<string, () => Promise<string>>

	/**
	 * Maximum gas price willing to pay for each chain
	 * Maps chainId to maximum gas price in wei
	 */
	maxGasPrice?: Record<string, string>

	/**
	 * Retry configuration for failed transactions
	 */
	retryConfig?: {
		/**
		 * Maximum number of retry attempts
		 */
		maxAttempts: number

		/**
		 * Initial delay between retries in ms
		 */
		initialDelayMs: number
	}
}

/**
 * Result of an order execution attempt
 */
export interface ExecutionResult {
	/**
	 * Whether the execution was successful
	 */
	success: boolean

	/**
	 * The transaction hash if successful
	 */
	txHash?: string

	/**
	 * Error message if unsuccessful
	 */
	error?: string

	/**
	 * Gas used by the transaction
	 */
	gasUsed?: string

	/**
	 * Gas price used for the transaction
	 */
	gasPrice?: string

	/**
	 * Total transaction cost in wei
	 */
	txCost?: string

	/**
	 * Block number when the transaction was confirmed
	 */
	confirmedAtBlock?: number

	/**
	 * Timestamp when the transaction was confirmed
	 */
	confirmedAt?: Date

	/**
	 * Actual profitability achieved
	 */
	actualProfitability?: number

	/**
	 * Strategy used to fill the order
	 */
	strategyUsed?: string

	/**
	 * Any tokens exchanged during the fill process
	 */
	exchanges?: Array<{
		fromToken: HexString
		toToken: HexString
		fromAmount: string
		toAmount: string
		exchangeRate: string
	}>

	/**
	 * The time it took to fill the order
	 */
	processingTimeMs?: number
}

/**
 * Represents a dispatch post for cross-chain communication
 */
export interface DispatchPost {
	/**
	 * Bytes representation of the destination state machine
	 */
	dest: HexString

	/**
	 * The destination module
	 */
	to: HexString

	/**
	 * The request body
	 */
	body: HexString

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
	payer: HexString
}
