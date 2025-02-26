import { GraphQLClient } from "graphql-request"
import maxBy from "lodash/maxBy"
import { pad } from "viem"

import {
	RequestStatus,
	PostRequestStatus,
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
import { postRequestCommitment, sleep } from "@/utils"
import { getChain, IChain, SubstrateChain } from "@/chain"

const REQUEST_STATUS_WEIGHTS: Record<RequestStatus, number> = {
	[RequestStatus.SOURCE]: 0,
	[RequestStatus.SOURCE_FINALIZED]: 1,
	[RequestStatus.HYPERBRIDGE_DELIVERED]: 2,
	[RequestStatus.HYPERBRIDGE_FINALIZED]: 3,
	[RequestStatus.DESTINATION]: 4,
	[RequestStatus.HYPERBRIDGE_TIMED_OUT]: 5,
	[RequestStatus.TIMED_OUT]: 6,
}

const TIMEOUT_STATUS_WEIGHTS: Record<TimeoutStatus, number> = {
	[TimeoutStatus.PENDING_TIMEOUT]: 1,
	[TimeoutStatus.DESTINATION_FINALIZED]: 2,
	[TimeoutStatus.HYPERBRIDGE_TIMED_OUT]: 3,
	[TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT]: 4,
	[TimeoutStatus.TIMED_OUT]: 5,
}

/**
 * IndexerClient provides methods for interacting with the Hyperbridge indexer
 */
export class IndexerClient {
	private client: GraphQLClient
	private config: ClientConfig
	private defaultRetryConfig: RetryConfig = {
		maxRetries: 3,
		backoffMs: 1000,
	}

	/**
	 * Creates a new HyperIndexerClient instance
	 */
	constructor(config: ClientConfig) {
		this.client = new GraphQLClient(config?.url || "http://localhost:3000/graphql")
		this.config = config
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

		const request: RequestWithStatus = {
			...response.requests.nodes[0],
			statuses: response.requests.nodes[0].statusMetadata.nodes.map((item) => ({
				status: item.status as any,
				metadata: {
					blockHash: item.blockHash,
					blockNumber: parseInt(item.blockNumber),
					transactionHash: item.transactionHash,
				},
			})),
		}

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
		const sourceFinality = await self.queryStateMachineUpdateByHeight(
			request.source,
			sortedMetadata[0].metadata.blockNumber,
		)

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

		const hyperbridgeFinality = await self.queryStateMachineUpdateByHeight(
			request.source,
			sortedMetadata[2].metadata.blockNumber,
		)
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
		const self = this
		const response = await self.withRetry(() =>
			self.client.request<RequestResponse>(REQUEST_STATUS, {
				hash,
			}),
		)

		if (!response.requests.nodes[0]) return

		const request = {
			...response.requests.nodes[0],
			statuses: response.requests.nodes[0].statusMetadata.nodes.map((item) => ({
				status: item.status as any,
				metadata: {
					blockHash: item.blockHash,
					blockNumber: parseInt(item.blockNumber),
					transactionHash: item.transactionHash,
				},
			})),
		}

		return await self.addFinalizationStatusEvents(request)
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
		if (request.timeoutTimestamp < destTimestamp) throw new Error(`Request not timed out`)

		let status: TimeoutStatus = TimeoutStatus.PENDING_TIMEOUT
		const commitment = postRequestCommitment(request)
		const hyperbridge = (await getChain({
			...self.config.hyperbridge,
			hasher: "Keccak",
		})) as unknown as SubstrateChain

		while (true) {
			// sort by ascending order
			const sorted = request.statuses
				.filter((node) => !!TIMEOUT_STATUS_WEIGHTS[node.status as TimeoutStatus])
				.sort(
					(a, b) =>
						TIMEOUT_STATUS_WEIGHTS[a.status as TimeoutStatus] -
						TIMEOUT_STATUS_WEIGHTS[b.status as TimeoutStatus],
				)
			const latest = sorted[sorted.length - 1]

			// we're always interested in the latest status
			status = maxBy(
				[status, latest.status as TimeoutStatus],
				(item) => TIMEOUT_STATUS_WEIGHTS[item as TimeoutStatus],
			)!

			switch (status) {
				case TimeoutStatus.PENDING_TIMEOUT: {
					const update = await self.queryStateMachineUpdateByTimestamp(request.dest, request.timeoutTimestamp)
					if (!update) break
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
					const update = (await self.queryStateMachineUpdateByTimestamp(
						request.dest,
						request.timeoutTimestamp,
					))!
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
					const update = await self.queryStateMachineUpdateByHeight(
						request.source,
						latest.metadata.blockNumber,
					)
					if (!update) break
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
			await sleep(self.config.pollInterval)
			request = (await self.queryRequest(hash))!
		}
	}

	/**
	 * Create a Stream of status updates for a post request.
	 * Stream updates will also emit a timeout event if the request times out.
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
		let request = await self.queryRequest(hash)
		while (true) {
			if (!request) {
				await sleep(self.config.pollInterval)
				request = await self.queryRequest(hash)
				continue
			}
			break
		}
		const chain = await getChain(self.config.dest)
		const timeoutStream = self.timeoutStream(request.timeoutTimestamp, chain)
		const statusStream = self.postRequestStatusStreamInternal(hash)

		// combine both streams here
		while (true) {
			const item = await Promise.race([timeoutStream.next(), statusStream.next()])
			if (item.done) {
				return
			}
			yield item.value
		}
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
				const diff = timeoutTimestamp - timestamp
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
		let status = RequestStatus.SOURCE

		while (true) {
			const request = await self.queryRequest(hash)
			if (!request) {
				await sleep(self.config.pollInterval)
				continue
			}

			// sort by ascending order
			const sortedMetadata = request.statuses.sort(
				(a, b) =>
					REQUEST_STATUS_WEIGHTS[a.status as RequestStatus] -
					REQUEST_STATUS_WEIGHTS[b.status as RequestStatus],
			)

			const latestMetadata = sortedMetadata[sortedMetadata.length - 1]
			const metadata = latestMetadata.metadata

			// we're always interested in the latest status
			status = maxBy(
				[status, latestMetadata.status as RequestStatus],
				(item) => REQUEST_STATUS_WEIGHTS[item as RequestStatus],
			)!

			switch (status) {
				// request has been dispatched from source chain
				case RequestStatus.SOURCE: {
					// query the latest state machine update for the source chain
					const sourceUpdate = await self.queryStateMachineUpdateByHeight(
						request.source,
						metadata.blockNumber,
					)

					if (sourceUpdate) {
						yield {
							status: RequestStatus.SOURCE_FINALIZED,
							metadata: {
								blockHash: sourceUpdate.blockHash,
								blockNumber: sourceUpdate.height,
								transactionHash: sourceUpdate.transactionHash,
							},
						}
						status = RequestStatus.SOURCE_FINALIZED
					}
					break
				}

				// finality proofs for request has been verified on Hyperbridge
				case RequestStatus.SOURCE_FINALIZED: {
					if (sortedMetadata.length >= 2) {
						const metadata = sortedMetadata[1].metadata

						yield {
							status: RequestStatus.HYPERBRIDGE_DELIVERED,
							metadata: {
								blockHash: metadata.blockHash,
								blockNumber: metadata.blockNumber,
								transactionHash: metadata.transactionHash,
							},
						}
						status = RequestStatus.HYPERBRIDGE_DELIVERED
					}
					break
				}

				// the request has been verified and aggregated on Hyperbridge
				case RequestStatus.HYPERBRIDGE_DELIVERED: {
					if (sortedMetadata.length < 2) {
						// not really sure what to do here
						break
					}

					// Get the latest state machine update for the source chain
					const hyperbridgeFinalized = await self.queryStateMachineUpdateByHeight(
						self.config.hyperbridge.stateMachineId,
						sortedMetadata[1].metadata.blockNumber,
					)

					if (hyperbridgeFinalized) {
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
					}
					break
				}

				// request has been finalized by hyperbridge
				case RequestStatus.HYPERBRIDGE_FINALIZED: {
					if (sortedMetadata.length < 3) {
						// also not really sure what to do here
						break
					}

					const metadata = sortedMetadata[2].metadata
					yield {
						status: RequestStatus.DESTINATION,
						metadata: {
							blockHash: metadata.blockHash,
							blockNumber: metadata.blockNumber,
							transactionHash: metadata.transactionHash,
						},
					}
					status = RequestStatus.DESTINATION
					break
				}

				case RequestStatus.DESTINATION:
					return
			}

			await sleep(self.config.pollInterval)
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

	/**
	 * Query for a single state machine update event greater than or equal to the given height.
	 * @params statemachineId - ID of the state machine
	 * @params height - Starting block height
	 * @returns Closest state machine update
	 */
	async queryStateMachineUpdateByHeight(
		statemachineId: string,
		height: number,
	): Promise<StateMachineUpdate | undefined> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES_BY_HEIGHT, {
				statemachineId,
				height,
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
	async queryStateMachineUpdateByTimestamp(
		statemachineId: string,
		timestamp: bigint,
	): Promise<StateMachineUpdate | undefined> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES_BY_TIMESTAMP, {
				statemachineId,
				timestamp: timestamp.toString(),
			}),
		)

		return response.stateMachineUpdateEvents.nodes[0]
	}
}
