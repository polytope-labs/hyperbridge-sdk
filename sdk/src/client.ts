import "dotenv/config"
import { GraphQLClient } from "graphql-request"
import { HexString } from "@polytope-labs/hyperclient"
import maxBy from "lodash/maxBy"
import { pad } from "viem"

import {
	RequestStatus,
	StatusResponse,
	StateMachineUpdate,
	BlockMetadata,
	RequestResponse,
	StateMachineResponse,
	ClientConfig,
	RetryConfig,
	RequestWithStatus,
} from "./types"
import { REQUEST_STATUS, STATE_MACHINE_UPDATES } from "./queries"
import { postRequestCommitment, sleep } from "./utils"
import { getChain, IChain } from "./chain"

const REQUEST_STATUS_WEIGHTS: Record<RequestStatus, number> = {
	[RequestStatus.SOURCE]: 0,
	[RequestStatus.SOURCE_FINALIZED]: 1,
	[RequestStatus.HYPERBRIDGE_DELIVERED]: 2,
	[RequestStatus.HYPERBRIDGE_FINALIZED]: 3,
	[RequestStatus.DESTINATION]: 4,
	[RequestStatus.HYPERBRIDGE_TIMED_OUT]: 5,
	[RequestStatus.TIMED_OUT]: 6,
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
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns Latest status and block metadata of the request
	 * @throws Error if request is not found
	 */
	async queryPostRequestWithStatus(hash: string): Promise<RequestWithStatus | undefined> {
		const self = this
		const response = await self.withRetry(() =>
			self.client.request<RequestResponse>(REQUEST_STATUS, {
				hash,
			}),
		)
		const request = response.requests.nodes[0]
		if (!request) {
			return
		}

		return request
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
	async *postRequestStatusStream(hash: HexString): AsyncGenerator<StatusResponse, void> {
		const self = this

		// wait for request to be created
		let request = await self.queryPostRequestWithStatus(hash)
		while (true) {
			if (!request) {
				await sleep(self.config.pollInterval)
				request = await self.queryPostRequestWithStatus(hash)
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
	async *timeoutStream(timeoutTimestamp: bigint, chain: IChain): AsyncGenerator<StatusResponse, void> {
		if (timeoutTimestamp > 0) {
			let timestamp = await chain.timestamp()
			while (timestamp < timeoutTimestamp) {
				const diff = timeoutTimestamp - timestamp
				await sleep(Number(diff))
				timestamp = await chain.timestamp()
			}
			yield { status: RequestStatus.TIMED_OUT }
			return
		}
	}

	/**
	 * Create a Stream of status updates
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns AsyncGenerator that emits status updates until a terminal state is reached
	 */
	private async *postRequestStatusStreamInternal(hash: string): AsyncGenerator<StatusResponse, void> {
		const self = this
		let status: RequestStatus | undefined = undefined

		while (true) {
			const request = await self.queryPostRequestWithStatus(hash)
			if (!request) {
				await sleep(self.config.pollInterval)
				continue
			}

			// sort by ascending order
			const sortedMetadata = request.statusMetadata.nodes.sort(
				(a, b) =>
					REQUEST_STATUS_WEIGHTS[a.status as RequestStatus] -
					REQUEST_STATUS_WEIGHTS[b.status as RequestStatus],
			)

			const latestMetadata = sortedMetadata[sortedMetadata.length - 1]
			const metadata = self.extractBlockMetadata(latestMetadata)

			// we're always interested in the latest status
			status = maxBy(
				[status, latestMetadata.status as RequestStatus],
				(item) => REQUEST_STATUS_WEIGHTS[item as RequestStatus],
			)

			switch (status) {
				// request has been dispatched from source chain
				case RequestStatus.SOURCE: {
					// query the latest state machine update for the source chain
					const sourceUpdate = await self.queryStateMachineUpdate(request.source, metadata.blockNumber)

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
						const metadata = self.extractBlockMetadata(sortedMetadata[1])

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
					const hyperbridgeFinalized = await self.queryStateMachineUpdate(
						self.config.hyperbridge.state_machine,
						parseInt(sortedMetadata[1].blockNumber),
					)

					if (hyperbridgeFinalized) {
						const destChain = await getChain(self.config.dest)
						const hyperbridge = await getChain({
							...self.config.hyperbridge,
							hash_algo: "Keccak",
						})

						const proof = await hyperbridge.queryRequestsProof(
							[postRequestCommitment(request)],
							request.dest,
							BigInt(hyperbridgeFinalized.height),
						)

						const calldata = destChain.encode({
							kind: "PostRequest",
							proof: {
								stateMachine: self.config.hyperbridge.state_machine,
								consensusStateId: self.config.hyperbridge.consensus_state_id,
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

				// final cases
				case RequestStatus.HYPERBRIDGE_FINALIZED:
				case RequestStatus.HYPERBRIDGE_DELIVERED: {
					if (sortedMetadata.length < 3) {
						// also not really sure what to do here
						break
					}

					const metadata = self.extractBlockMetadata(sortedMetadata[2])
					yield {
						status: RequestStatus.HYPERBRIDGE_DELIVERED,
						metadata: {
							blockHash: metadata.blockHash,
							blockNumber: metadata.blockNumber,
							transactionHash: metadata.transactionHash,
						},
					}
				}
			}

			if (status === RequestStatus.DESTINATION) {
				return
			}

			await sleep(self.config.pollInterval)
		}
	}

	/**
	 * Extract block metadata from raw response data
	 * @param data - Raw block metadata from GraphQL response
	 * @returns Formatted block metadata
	 */
	private extractBlockMetadata(data: any): BlockMetadata {
		return {
			blockHash: data.blockHash,
			blockNumber: parseInt(data.blockNumber),
			transactionHash: data.transactionHash,
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
	 * Query for a state machine update event greater than or equal to the given height
	 * @params statemachineId - ID of the state machine
	 * @params height - Starting block height
	 * @params chain - Chain identifier
	 * @returns Closest state machine update
	 */
	async queryStateMachineUpdate(statemachineId: string, height: number): Promise<StateMachineUpdate> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES, {
				statemachineId,
				height,
			}),
		)

		return response.stateMachineUpdateEvents.nodes[0]
	}
}
