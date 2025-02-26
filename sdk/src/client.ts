import { GraphQLClient } from "graphql-request"
import maxBy from "lodash/maxBy"
import { pad } from "viem"

// @ts-ignore
import mergeRace from "@async-generator/merge-race"

import {
	RequestStatus,
	StateMachineUpdate,
	RequestResponse,
	StateMachineResponse,
	ClientConfig,
	RetryConfig,
	RequestWithStatus,
	HexString,
	TimeoutStatus,
	PostRequestTimeoutStatus,
	RequestStatusWithMetadata,
} from "@/types"
import { REQUEST_STATUS, STATE_MACHINE_UPDATES_BY_HEIGHT, STATE_MACHINE_UPDATES_BY_TIMESTAMP } from "@/queries"
import { REQUEST_STATUS_WEIGHTS, TIMEOUT_STATUS_WEIGHTS, postRequestCommitment, sleep } from "@/utils"
import { getChain, IChain, SubstrateChain } from "@/chain"

/**
 * IndexerClient provides methods for interacting with the Hyperbridge indexer.
 *
 * This client facilitates querying and tracking cross-chain requests and their status
 * through the Hyperbridge protocol. It supports:
 *
 * - Querying state machine updates by block height or timestamp
 * - Retrieving request status information by transaction hash
 * - Monitoring request status changes through streaming interfaces
 * - Handling request timeout flows and related proof generation
 * - Tracking request finalization across source and destination chains
 *
 * The client implements automatic retries with exponential backoff for network
 * resilience and provides both simple query methods and advanced streaming
 * interfaces for real-time status tracking.
 *
 * @example
 * ```typescript
 * const client = new IndexerClient({
 *   url: "https://indexer.hyperbridge.xyz/graphql",
 *   pollInterval: 2000,
 *   source: {
 *		stateMachineId: "EVM-1",
 * 		consensusStateId: "ETH0"
 *		rpcUrl: "",
 *		host: "0x87ea45..",
 * 	},
 *   dest: {
 *		stateMachineId: "EVM-42161",
 * 		consensusStateId: "ETH0"
 *		stateMachineId: "EVM-",
 *		host: "0x87ea42345..",
 * 	},
 *   hyperbridge: {
 *     stateMachineId: "hyperbridge-1",
 *     consensusStateId: "PARA"
 *     wsUrl: "ws://localhost:9944"
 *   }
 * });
 *
 * // Query a request status
 * const status = await client.queryRequestWithStatus("0x1234...");
 *
 * // Stream status updates
 * for await (const update of client.postRequestStatusStream("0x1234...")) {
 *   console.log(`Request status: ${update.status}`);
 * }
 * ```
 */
export class IndexerClient {
	/**
	 * GraphQL client used for making requests to the indexer
	 */
	private client: GraphQLClient

	/**
	 * Configuration for the IndexerClient including URLs, poll intervals, and chain-specific settings
	 */
	private config: ClientConfig

	/**
	 * Default configuration for retry behavior when network requests fail
	 * - maxRetries: Maximum number of retry attempts before failing
	 * - backoffMs: Initial backoff time in milliseconds (doubles with each retry)
	 */
	private defaultRetryConfig: RetryConfig = {
		maxRetries: 3,
		backoffMs: 1000,
	}

	/**
	 * Creates a new IndexerClient instance
	 */
	constructor(config: ClientConfig) {
		this.client = new GraphQLClient(config?.url || "http://localhost:3000/graphql")
		this.config = config
	}

	/**
	 * Query for a single state machine update event greater than or equal to the given height.
	 * @params statemachineId - ID of the state machine
	 * @params chain - Chain ID of the state machine
	 * @params height - Starting block height
	 * @returns Closest state machine update
	 */
	async queryStateMachineUpdateByHeight({
		statemachineId,
		height,
		chain,
	}: {
		statemachineId: string
		chain: string
		height: number
	}): Promise<StateMachineUpdate | undefined> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES_BY_HEIGHT, {
				statemachineId,
				height,
				chain,
			}),
		)

		return response.stateMachineUpdateEvents.nodes[0]
	}

	/**
	 * Query for a single state machine update event greater than or equal to the given timestamp.
	 * @params statemachineId - ID of the state machine
	 * @params timestamp - Starting block timestamp
	 * @returns Closest state machine update
	 */
	async queryStateMachineUpdateByTimestamp({
		statemachineId,
		commitmentTimestamp,
		chain,
	}: {
		statemachineId: string
		commitmentTimestamp: bigint
		chain: string
	}): Promise<StateMachineUpdate | undefined> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES_BY_TIMESTAMP, {
				statemachineId,
				commitmentTimestamp: commitmentTimestamp.toString(),
				chain,
			}),
		)

		return response.stateMachineUpdateEvents.nodes[0]
	}

	/**
	 * Queries a request by any of its associated hashes and returns it alongside its statuses
	 * Statuses will be one of SOURCE, HYPERBRIDGE_DELIVERED and DESTINATION
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns Latest status and block metadata of the request
	 */
	async queryRequest(hash: string): Promise<RequestWithStatus | undefined> {
		const self = this
		const response = await self.withRetry(() =>
			self.client.request<RequestResponse>(REQUEST_STATUS, {
				hash,
			}),
		)

		if (!response.requests.nodes[0]) return

		const statuses = response.requests.nodes[0].statusMetadata.nodes.map((item) => ({
			status: item.status as any,
			metadata: {
				blockHash: item.blockHash,
				blockNumber: parseInt(item.blockNumber),
				transactionHash: item.transactionHash,
			},
		}))

		// sort by ascending order
		const sorted = statuses.sort(
			(a, b) =>
				REQUEST_STATUS_WEIGHTS[a.status as RequestStatus] - REQUEST_STATUS_WEIGHTS[b.status as RequestStatus],
		)

		const request: RequestWithStatus = {
			...response.requests.nodes[0],
			statuses: sorted,
		}

		// @ts-ignore
		delete request.statusMetadata

		return request
	}

	/**
	 * Fills in finalization events for a request by querying state machine updates
	 * @param request - Request to fill finalization events for
	 * @returns Request with finalization events filled in including SOURCE_FINALIZED and HYPERBRIDGE_FINALIZED statuses
	 */
	private async addFinalizationStatusEvents(request: RequestWithStatus): Promise<RequestWithStatus> {
		const self = this

		// sort by ascending order
		const sortedMetadata = request.statuses.sort(
			(a, b) =>
				REQUEST_STATUS_WEIGHTS[a.status as RequestStatus] - REQUEST_STATUS_WEIGHTS[b.status as RequestStatus],
		)

		// we assume there's always a SOURCE event which contains the blocknumber of the initial request
		const sourceFinality = await self.queryStateMachineUpdateByHeight({
			statemachineId: request.source,
			height: sortedMetadata[0].metadata.blockNumber,
			chain: self.config.hyperbridge.stateMachineId,
		})

		// no finality event found, return request as is
		if (!sourceFinality) return request

		// Insert finality event into sortedMetadata at index 1
		sortedMetadata.splice(1, 0, {
			status: RequestStatus.SOURCE_FINALIZED,
			metadata: {
				blockHash: sourceFinality.blockHash,
				blockNumber: sourceFinality.height,
				transactionHash: sourceFinality.transactionHash,
			},
		})

		// check if there's a hyperbridge delivered event
		if (sortedMetadata.length < 3) return request

		const hyperbridgeFinality = await self.queryStateMachineUpdateByHeight({
			statemachineId: self.config.hyperbridge.stateMachineId,
			height: sortedMetadata[2].metadata.blockNumber,
			chain: request.dest,
		})
		if (!hyperbridgeFinality) return request

		const destChain = await getChain(self.config.dest)
		const hyperbridge = await getChain({
			...self.config.hyperbridge,
			hasher: "Keccak",
		})

		const proof = await hyperbridge.queryRequestsProof(
			[postRequestCommitment(request)],
			request.dest,
			BigInt(hyperbridgeFinality.height),
		)

		const calldata = destChain.encode({
			kind: "PostRequest",
			proof: {
				stateMachine: self.config.hyperbridge.stateMachineId,
				consensusStateId: self.config.hyperbridge.consensusStateId,
				proof,
				height: BigInt(hyperbridgeFinality.height),
			},
			requests: [request],
			signer: pad("0x"),
		})

		// Insert finality into sortedMetadata at index 3
		sortedMetadata.splice(3, 0, {
			status: RequestStatus.HYPERBRIDGE_FINALIZED,
			metadata: {
				blockHash: hyperbridgeFinality.blockHash,
				blockNumber: hyperbridgeFinality.height,
				transactionHash: hyperbridgeFinality.transactionHash,
				calldata,
			},
		})

		// todo: timeout stuff
		// check if request is timed out
		// if it is, try to query for destination finalized event and insert it
		// if metadata.length < 5
		// check if hyperbridgeFinality for timeout
		// insert it

		request.statuses = sortedMetadata

		return request
	}

	/**
	 * Queries a request by any of its associated hashes and returns it alongside its statuses,
	 * including any finalization events.
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns Full request data with all inferred status events, including SOURCE_FINALIZED and HYPERBRIDGE_FINALIZED
	 * @remarks Unlike queryRequest(), this method adds derived finalization status events by querying state machine updates
	 */
	async queryRequestWithStatus(hash: string): Promise<RequestWithStatus | undefined> {
		const request = await this.queryRequest(hash)

		if (!request) return

		return await this.addFinalizationStatusEvents(request)
	}

	/**
	 * Create a Stream of status updates for a post request.
	 * Stream ends when either the request reaches the destination or times out
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns AsyncGenerator that emits status updates until a terminal state is reached
	 * @example
	 *
	 * let client = new IndexerClient(config)
	 * let stream = client.postRequestStatusStream(hash)
	 *
	 * // you can use a for-await-of loop
	 * for await (const status of stream) {
	 *   console.log(status)
	 * }
	 *
	 * // you can also use a while loop
	 * while (true) {
	 *   const status = await stream.next()
	 *   if (status.done) {
	 *     break
	 *   }
	 *   console.log(status.value)
	 * }
	 *
	 */
	async *postRequestStatusStream(hash: HexString): AsyncGenerator<RequestStatusWithMetadata, void> {
		const self = this

		// wait for request to be created
		let request: RequestWithStatus | undefined
		while (!request) {
			await sleep(self.config.pollInterval)
			request = await self.queryRequest(hash)
			continue
		}

		const chain = await getChain(self.config.dest)
		const timeoutStream = self.timeoutStream(request.timeoutTimestamp, chain)
		const statusStream = self.postRequestStatusStreamInternal(hash)
		const combined = mergeRace(timeoutStream, statusStream)

		let item = await combined.next()
		while (!item.done) {
			yield item.value
			item = await combined.next()
		}
		return
	}

	/*
	 * Returns a generator that will yield true if the request is timed out
	 * If the request does not have a timeout, it will yield never yield
	 * @param request - Request to timeout
	 */
	async *timeoutStream(timeoutTimestamp: bigint, chain: IChain): AsyncGenerator<RequestStatusWithMetadata, void> {
		if (timeoutTimestamp > 0) {
			let timestamp = await chain.timestamp()
			while (timestamp < timeoutTimestamp) {
				const diff = BigInt(timeoutTimestamp) - BigInt(timestamp)
				await sleep(Number(diff))
				timestamp = await chain.timestamp()
			}
			yield {
				status: TimeoutStatus.PENDING_TIMEOUT,
				metadata: { blockHash: "0x", blockNumber: 0, transactionHash: "0x" },
			}
			return
		}
	}

	/**
	 * Create a Stream of status updates
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns AsyncGenerator that emits status updates until a terminal state is reached
	 */
	private async *postRequestStatusStreamInternal(hash: string): AsyncGenerator<RequestStatusWithMetadata, void> {
		const self = this
		let request: RequestWithStatus | undefined
		while (!request) {
			await sleep(self.config.pollInterval)
			request = await self.queryRequest(hash)
		}

		let status = RequestStatus.SOURCE
		const latestMetadata = request.statuses[request.statuses.length - 1]
		// start with the latest status
		status = maxBy(
			[status, latestMetadata.status as RequestStatus],
			(item) => REQUEST_STATUS_WEIGHTS[item as RequestStatus],
		)!

		while (true) {
			switch (status) {
				// request has been dispatched from source chain
				case RequestStatus.SOURCE: {
					let sourceUpdate: StateMachineUpdate | undefined
					while (!sourceUpdate) {
						await sleep(self.config.pollInterval)
						sourceUpdate = await self.queryStateMachineUpdateByHeight({
							statemachineId: request.source,
							height: request.statuses[0].metadata.blockNumber,
							chain: self.config.hyperbridge.stateMachineId,
						})
					}

					yield {
						status: RequestStatus.SOURCE_FINALIZED,
						metadata: {
							blockHash: sourceUpdate.blockHash,
							blockNumber: sourceUpdate.height,
							transactionHash: sourceUpdate.transactionHash,
						},
					}
					status = RequestStatus.SOURCE_FINALIZED
					break
				}

				// finality proofs for request has been verified on Hyperbridge
				case RequestStatus.SOURCE_FINALIZED: {
					// wait for the request to be delivered on Hyperbridge
					while (!request || request.statuses.length < 2) {
						await sleep(self.config.pollInterval)
						request = await self.queryRequest(hash)
					}

					yield {
						status: RequestStatus.HYPERBRIDGE_DELIVERED,
						metadata: {
							blockHash: request.statuses[1].metadata.blockHash,
							blockNumber: request.statuses[1].metadata.blockNumber,
							transactionHash: request.statuses[1].metadata.transactionHash,
						},
					}
					status = RequestStatus.HYPERBRIDGE_DELIVERED
					break
				}

				// the request has been verified and aggregated on Hyperbridge
				case RequestStatus.HYPERBRIDGE_DELIVERED: {
					// Get the latest state machine update for hyperbridge on the destination chain
					let hyperbridgeFinalized: StateMachineUpdate | undefined
					while (!hyperbridgeFinalized) {
						await sleep(self.config.pollInterval)
						hyperbridgeFinalized = await self.queryStateMachineUpdateByHeight({
							statemachineId: self.config.hyperbridge.stateMachineId,
							height: request.statuses[1].metadata.blockNumber,
							chain: request.dest,
						})
					}

					const destChain = await getChain(self.config.dest)
					const hyperbridge = await getChain({
						...self.config.hyperbridge,
						hasher: "Keccak",
					})

					const proof = await hyperbridge.queryRequestsProof(
						[postRequestCommitment(request)],
						request.dest,
						BigInt(hyperbridgeFinalized.height),
					)

					const calldata = destChain.encode({
						kind: "PostRequest",
						proof: {
							stateMachine: self.config.hyperbridge.stateMachineId,
							consensusStateId: self.config.hyperbridge.consensusStateId,
							proof,
							height: BigInt(hyperbridgeFinalized.height),
						},
						requests: [request],
						signer: pad("0x"),
					})

					yield {
						status: RequestStatus.HYPERBRIDGE_FINALIZED,
						metadata: {
							blockHash: hyperbridgeFinalized.blockHash,
							blockNumber: hyperbridgeFinalized.height,
							transactionHash: hyperbridgeFinalized.transactionHash,
							calldata,
						},
					}
					status = RequestStatus.HYPERBRIDGE_FINALIZED
					break
				}

				// request has been finalized by hyperbridge
				case RequestStatus.HYPERBRIDGE_FINALIZED: {
					// wait for the request to be delivered on Hyperbridge
					while (!request || request.statuses.length < 3) {
						await sleep(self.config.pollInterval)
						request = await self.queryRequest(hash)
					}

					yield {
						status: RequestStatus.DESTINATION,
						metadata: {
							blockHash: request.statuses[2].metadata.blockHash,
							blockNumber: request.statuses[2].metadata.blockNumber,
							transactionHash: request.statuses[2].metadata.transactionHash,
						},
					}
					status = RequestStatus.DESTINATION
					break
				}

				case RequestStatus.DESTINATION:
					return
			}
		}
	}

	/**
	 * Create a Stream of status updates for a timed out post request.
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns AsyncGenerator that emits status updates until a terminal state is reached
	 * @example
	 *
	 * let client = new IndexerClient(config)
	 * let stream = client.postRequestTimeoutStream(hash)
	 *
	 * // you can use a for-await-of loop
	 * for await (const status of stream) {
	 *   console.log(status)
	 * }
	 *
	 * // you can also use a while loop
	 * while (true) {
	 *   const status = await stream.next()
	 *   if (status.done) {
	 *     break
	 *   }
	 *   console.log(status.value)
	 * }
	 */
	async *postRequestTimeoutStream(hash: HexString): AsyncGenerator<PostRequestTimeoutStatus, void> {
		const self = this
		let request = await self.queryRequest(hash)
		if (!request) throw new Error(`Request not found`)

		const destChain = await getChain(self.config.dest)
		const destTimestamp = await destChain.timestamp()
		if (request.timeoutTimestamp > destTimestamp) throw new Error(`Request not timed out`)

		let status: TimeoutStatus = TimeoutStatus.PENDING_TIMEOUT
		const commitment = postRequestCommitment(request)
		const hyperbridge = (await getChain({
			...self.config.hyperbridge,
			hasher: "Keccak",
		})) as unknown as SubstrateChain

		const latest = request.statuses[request.statuses.length - 1]

		// we're always interested in the latest status
		status = maxBy(
			[status, latest.status as TimeoutStatus],
			(item) => TIMEOUT_STATUS_WEIGHTS[item as TimeoutStatus],
		)!

		while (true) {
			switch (status) {
				case TimeoutStatus.PENDING_TIMEOUT: {
					let update: StateMachineUpdate | undefined
					while (!update) {
						await sleep(self.config.pollInterval)
						update = await self.queryStateMachineUpdateByTimestamp({
							statemachineId: request.dest,
							commitmentTimestamp: request.timeoutTimestamp,
							chain: self.config.hyperbridge.stateMachineId,
						})
					}

					yield {
						status: TimeoutStatus.DESTINATION_FINALIZED,
						metadata: {
							blockHash: update.blockHash,
							blockNumber: update.height,
							transactionHash: update.transactionHash,
						},
					}
					status = TimeoutStatus.DESTINATION_FINALIZED
					break
				}

				case TimeoutStatus.DESTINATION_FINALIZED: {
					// todo: check if request exists on hyperbridge before submitting
					const update = (await self.queryStateMachineUpdateByTimestamp({
						statemachineId: request.dest,
						commitmentTimestamp: request.timeoutTimestamp,
						chain: self.config.hyperbridge.stateMachineId,
					}))!

					const proof = await destChain.queryStateProof(BigInt(update.height), [
						destChain.requestReceiptKey(commitment),
					])

					let { blockHash, transactionHash } = await hyperbridge.submitUnsigned({
						kind: "TimeoutPostRequest",
						proof: {
							proof,
							height: BigInt(update.height),
							stateMachine: request.dest,
							consensusStateId: self.config.dest.consensusStateId,
						},
						requests: [request],
					})

					const header = await hyperbridge.api?.rpc.chain.getHeader(blockHash)
					yield {
						status: TimeoutStatus.HYPERBRIDGE_TIMED_OUT,
						metadata: {
							blockHash,
							transactionHash,
							blockNumber: header?.number.toNumber(),
						},
					}
					status = TimeoutStatus.HYPERBRIDGE_TIMED_OUT
					break
				}

				case TimeoutStatus.HYPERBRIDGE_TIMED_OUT:
					let update: StateMachineUpdate | undefined
					while (!update) {
						await sleep(self.config.pollInterval)
						update = await self.queryStateMachineUpdateByHeight({
							statemachineId: request.source,
							chain: self.config.hyperbridge.stateMachineId,
							height: latest.metadata.blockNumber,
						})
					}

					const proof = await hyperbridge.queryStateProof(BigInt(update.height), [
						hyperbridge.requestReceiptKey(commitment),
					])

					const sourceChain = await getChain(self.config.source)
					let calldata = sourceChain.encode({
						kind: "TimeoutPostRequest",
						proof: {
							proof,
							height: BigInt(update.height),
							stateMachine: request.dest,
							consensusStateId: self.config.dest.consensusStateId,
						},
						requests: [request],
					})
					yield {
						status: TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT,
						metadata: {
							transactionHash: update.transactionHash,
							blockNumber: update.blockNumber,
							blockHash: update.blockHash,
							calldata,
						},
					}
					status = TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT
					break

				case TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT:
				case TimeoutStatus.TIMED_OUT:
					return
			}
		}
	}

	/**
	 * Executes an async operation with exponential backoff retry
	 * @param operation - Async function to execute
	 * @param retryConfig - Optional retry configuration
	 * @returns Result of the operation
	 * @throws Last encountered error after all retries are exhausted
	 *
	 * @example
	 * const result = await this.withRetry(() => this.queryStatus(hash));
	 */
	private async withRetry<T>(
		operation: () => Promise<T>,
		retryConfig: RetryConfig = this.defaultRetryConfig,
	): Promise<T> {
		let lastError
		for (let i = 0; i < retryConfig.maxRetries; i++) {
			try {
				return await operation()
			} catch (error) {
				lastError = error
				await new Promise((resolve) => setTimeout(resolve, retryConfig.backoffMs * Math.pow(2, i)))
			}
		}
		throw lastError
	}
}
