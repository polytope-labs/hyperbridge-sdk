import "dotenv/config"
import { GraphQLClient } from "graphql-request"
import { REQUEST_STATUS, STATE_MACHINE_UPDATES } from "./queries"
import {
	RequestStatus,
	StatusResponse,
	StateMachineUpdate,
	BlockMetadata,
	RequestResponse,
	StateMachineResponse,
	ClientConfig,
	RetryConfig,
	HyperClientStatus,
	RequestWithStatus,
} from "./types"
import { getHyperClient } from "./hyperclient"
import { HYPERBRIDGE, HYPERBRIDGE_TESTNET } from "./hyperclient/constants"
import { MessageStatusWithMeta } from "@polytope-labs/hyperclient"

const REQUEST_STATUS_WEIGHTS: Record<RequestStatus, number> = {
	[RequestStatus.SOURCE]: 1,
	[RequestStatus.HYPERBRIDGE_DELIVERED]: 2,
	[RequestStatus.DESTINATION]: 3,
	[RequestStatus.HYPERBRIDGE_TIMED_OUT]: 4,
	[RequestStatus.TIMED_OUT]: 5,
}

/**
 * IndexerClient provides methods for interacting with the Hyperbridge indexer
 */
export class IndexerClient {
	private client: GraphQLClient
	private config: ClientConfig
	private pollInterval: number = 3000
	private defaultRetryConfig: RetryConfig = {
		maxRetries: 3,
		backoffMs: 1000,
	}

	/**
	 * Creates a new HyperIndexerClient instance
	 */
	constructor(config: ClientConfig) {
		this.client = new GraphQLClient(config?.url || "http://localhost:3000/graphql")
		this.pollInterval = config?.pollInterval || 10000
		this.config = config
	}

	/**
	 * Queries a request by any of its associated hashes and returns it alongside its statuses
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns Latest status and block metadata of the request
	 * @throws Error if request is not found
	 */
	async queryPostRequestWithStatus(hash: string): Promise<RequestWithStatus | null> {
		const response = await this.client.request<RequestResponse>(REQUEST_STATUS, {
			hash,
		})
		const request = response.requests.nodes[0]
		if (!request) {
			return null
		}

		return response.requests.nodes[0]
	}

	/**
	 * Create a Stream of status updates
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns AsyncGenerator that emits status updates until a terminal state is reached
	 */
	async *postRequestStatusStream(hash: string): AsyncGenerator<StatusResponse> {
		const self = this
		let status: RequestStatus | null = null

		// todo: implement timeout check stream

		while (true) {
			const response = await self.withRetry(() =>
				self.client.request<RequestResponse>(REQUEST_STATUS, {
					hash,
				}),
			)

			const request = response.requests.nodes[0]
			if (!request) {
				await new Promise((resolve) => setTimeout(resolve, self.pollInterval))
				continue
			}

			const sortedMetadata = request.statusMetadata.nodes.sort(
				(a, b) =>
					REQUEST_STATUS_WEIGHTS[b.status as RequestStatus] -
					REQUEST_STATUS_WEIGHTS[a.status as RequestStatus],
			)

			const latestMetadata = sortedMetadata[0]
			const metadata = self.extractBlockMetadata(latestMetadata)

			if (!status) {
				status = latestMetadata.status as RequestStatus
			}

			switch (status) {
				case RequestStatus.SOURCE: {
					// Get the latest state machine update for the source chain
					const sourceUpdate = await self.getClosestStateMachineUpdate(request.source, metadata.blockNumber)

					// Only emit SOURCE_FINALIZED if we haven't emitted it yet
					if (!sourceUpdate) {
						continue
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

				case RequestStatus.HYPERBRIDGE_DELIVERED: {
					// Get the latest state machine update for the source chain
					const hyperbridgeFinalized = await self.getClosestStateMachineUpdate(
						self.config.hyperbridgeStateMachineId,
						// todo: block number from hyperbridge delivery
						metadata.blockNumber,
					)

					// Only emit SOURCE_FINALIZED if we haven't emitted it yet
					if (!hyperbridgeFinalized) {
						continue
					}

					yield {
						status: RequestStatus.HYPERBRIDGE_FINALIZED,
						metadata: {
							blockHash: hyperbridgeFinalized.blockHash,
							blockNumber: hyperbridgeFinalized.height,
							transactionHash: hyperbridgeFinalized.transactionHash,
							// todo: get calldata from hyperclient
							calldata: "",
						},
					}
					status = RequestStatus.HYPERBRIDGE_FINALIZED
					break
				}

				case RequestStatus.HYPERBRIDGE_FINALIZED: {
					if (sortedMetadata.length === 3) {
						const metadata = self.extractBlockMetadata(sortedMetadata[2])

						yield {
							status: RequestStatus.HYPERBRIDGE_DELIVERED,
							metadata: {
								blockHash: metadata.blockHash,
								blockNumber: metadata.blockNumber,
								transactionHash: metadata.transactionHash,
							},
						}
						status = RequestStatus.DESTINATION
					}

					break
				}
			}

			if (self.isTerminalStatus(status)) {
				return
			}

			await new Promise((resolve) => setTimeout(resolve, self.pollInterval))
		}
	}

	/**
	 * Create a ReadableStream of state machine updates
	 * @param statemachineId - ID of the state machine to monitor
	 * @param height - Starting block height
	 * @param chain - Chain identifier
	 * @returns ReadableStream that emits state machine updates
	 */
	createStateMachineUpdateStream(
		statemachineId: string,
		height: number,
		chain: string,
	): ReadableStream<StateMachineUpdate> {
		const self = this
		return new ReadableStream({
			async start(controller) {
				let currentHeight = height

				while (true) {
					try {
						const response = await self.withRetry(() =>
							self.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES, {
								statemachineId,
								height: currentHeight,
								chain,
							}),
						)

						const updates = response.stateMachineUpdateEvents.nodes

						// Find closest update >= height
						const closestUpdate = updates
							.filter((update) => update.height >= currentHeight)
							.sort((a, b) => a.height - b.height)[0]

						if (closestUpdate) {
							currentHeight = closestUpdate.height
							controller.enqueue(closestUpdate)

							// Stream subsequent updates
							updates
								.filter((update) => update.height > currentHeight)
								.sort((a, b) => a.height - b.height)
								.forEach((update) => {
									controller.enqueue(update)
									currentHeight = update.height
								})
						}

						currentHeight += 1
						await new Promise((resolve) => setTimeout(resolve, self.pollInterval))
					} catch (error) {
						controller.error(error)
					}
				}
			},
		})
	}

	/**
	 * Check if a status represents a terminal state
	 * @param status - Request status to check
	 * @returns true if status is terminal (DELIVERED or TIMED_OUT)
	 */
	private isTerminalStatus(status: RequestStatus): boolean {
		// todo: should actually check if request is timed out.
		return status === RequestStatus.DESTINATION
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
			timestamp: BigInt(data.timestamp),
			chain: data.chain,
			transactionHash: data.transactionHash,
			status: data.status,
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
	 * Get the closest state machine update for a given height
	 * @params statemachineId - ID of the state machine
	 * @params height - Starting block height
	 * @params chain - Chain identifier
	 * @returns Closest state machine update
	 */
	private async getClosestStateMachineUpdate(statemachineId: string, height: number): Promise<StateMachineUpdate> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES, {
				statemachineId,
				height,
			}),
		)

		return response.stateMachineUpdateEvents.nodes[0]
	}
}
