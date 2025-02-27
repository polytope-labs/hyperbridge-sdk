import { HexString, IEvmConfig, IPostRequest, ISubstrateConfig } from "@/types"
import { isEvmChain, isSubstrateChain } from "@/utils"
import { EvmChain, SubstrateChain } from "@/chain"

export * from "@/chains/evm"
export * from "@/chains/substrate"

/**
 * Type representing an ISMP message.
 */
export type IIsmpMessage = IRequestMessage | ITimeoutPostRequestMessage

export interface IRequestMessage {
	/**
	 * The kind of message.
	 */
	kind: "PostRequest"
	/**
	 * The requests to be posted.
	 */
	requests: IPostRequest[]
	/**
	 * The proof of the requests.
	 */
	proof: IProof
	/**
	 * The signer of the message.
	 */
	signer: HexString
}

export interface ITimeoutPostRequestMessage {
	/**
	 * The kind of message.
	 */
	kind: "TimeoutPostRequest"

	/**
	 * The requests to be posted.
	 */
	requests: IPostRequest[]

	/**
	 * The proof of the requests.
	 */
	proof: IProof
}

export interface IProof {
	/**
	 * The height of the proof.
	 */
	height: bigint
	/**
	 * The state machine identifier of the proof.
	 */
	stateMachine: string

	/**
	 * The associated consensus state identifier of the proof.
	 */
	consensusStateId: string

	/**
	 * The encoded storage proof
	 */
	proof: HexString
}

/**
 * Interface representing a chain.
 */
export interface IChain {
	/*
	 * Returns the current timestamp of the chain.
	 */
	timestamp(): Promise<bigint>

	/**
	 * Returns the state trie key for the request-receipt storage item for the given request commitment.
	 */
	requestReceiptKey(commitment: HexString): HexString

	/**
	 * Query and return the request-receipt for the given request commitment.
	 */
	queryRequestReceipt(commitment: HexString): Promise<HexString | undefined>

	/**
	 * Query and return the encoded storage proof for the provided keys at the given height.
	 */
	queryStateProof(at: bigint, keys: HexString[]): Promise<HexString>

	/*
	 * Query and return the encoded storage proof for requests
	 */
	queryRequestsProof(requests: HexString[], counterparty: string, at?: bigint): Promise<HexString>

	/*
	 * Encode an ISMP message into the appropriate calldata for this chain.
	 */
	encode(message: IIsmpMessage): HexString
}

/**
 * Returns the chain interface for a given state machine identifier
 * @param chainConfig - Chain configuration
 * @returns Chain interface
 */
export async function getChain(chainConfig: IEvmConfig | ISubstrateConfig): Promise<IChain> {
	if (isEvmChain(chainConfig.stateMachineId)) {
		const config = chainConfig as IEvmConfig
		const chainId = parseInt(chainConfig.stateMachineId.split("-")[1])
		const evmChain = new EvmChain({
			chainId,
			url: config.rpcUrl,
			host: config.host as any,
		})

		return evmChain
	} else if (isSubstrateChain(chainConfig.stateMachineId)) {
		const config = chainConfig as ISubstrateConfig
		const substrateChain = new SubstrateChain({
			ws: config.wsUrl,
			hasher: config.hasher,
		})

		await substrateChain.connect()

		return substrateChain
	} else {
		throw new Error(`Unsupported chain: ${chainConfig.stateMachineId}`)
	}
}
