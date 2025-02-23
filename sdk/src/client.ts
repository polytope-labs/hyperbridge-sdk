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
 * HyperIndexerClient provides methods to interact with the Hyperbridge indexer
 */
export class HyperIndexerClient {
	private client: GraphQLClient
	private pollInterval: number = 3000
	private defaultRetryConfig: RetryConfig = {
		maxRetries: 3,
		backoffMs: 1000,
	}

	/**
	 * Creates a new HyperIndexerClient instance
	 */
	constructor(config?: ClientConfig) {
		this.client = new GraphQLClient("http://localhost:3000/graphql")
		this.pollInterval = config?.pollInterval || 10000
	}

	/**
	 * Query the latest status of a request by any of its associated hashes
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns Latest status and block metadata of the request
	 * @throws Error if request is not found
	 */
	async queryStatus(hash: string): Promise<StatusResponse> {
		const response = await this.client.request<RequestResponse>(REQUEST_STATUS, {
			hash,
		})
		const request = response.requests.nodes[0]

		if (!request) {
			// throw new Error(`No request found for hash: ${hash}`);
			return {
				status: HyperClientStatus.PENDING,
				metadata: {},
				message: "No request found, waiting for indexer to process...",
			}
		}

		const sortedMetadata = request.statusMetadata.nodes.sort(
			(a, b) =>
				REQUEST_STATUS_WEIGHTS[b.status as RequestStatus] - REQUEST_STATUS_WEIGHTS[a.status as RequestStatus],
		)

		const latestMetadata = sortedMetadata[0]

		const metadata = this.extractBlockMetadata(latestMetadata)
		return {
			status: metadata.status as RequestStatus,
			metadata: {
				blockHash: metadata.blockHash,
				blockNumber: metadata.blockNumber,
				chain: metadata.chain,
				transactionHash: metadata.transactionHash,
			},
		}
	}

	/**
	 * Create a ReadableStream of status updates
	 * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
	 * @returns ReadableStream that emits status updates until a terminal state is reached
	 */
	createStatusStream(hash: string): ReadableStream<StatusResponse> {
		const self = this
		return new ReadableStream({
			async start(controller) {
				let lastStatus: RequestStatus | HyperClientStatus | null = null
				while (true) {
					try {
						const response = await self.withRetry(() =>
							self.client.request<RequestResponse>(REQUEST_STATUS, {
								hash,
							}),
						)

						const request = response.requests.nodes[0]
						if (!request) {
							controller.enqueue({
								status: HyperClientStatus.PENDING,
								metadata: {},
								message: "No request found, waiting for indexer to process...",
							})
							await new Promise((resolve) => setTimeout(resolve, self.pollInterval))
							continue
						}

						const sortedMetadata = request.statusMetadata.nodes.sort(
							(a, b) =>
								REQUEST_STATUS_WEIGHTS[b.status as RequestStatus] -
								REQUEST_STATUS_WEIGHTS[a.status as RequestStatus],
						)

						const latestMetadata = sortedMetadata[0]
						const status = latestMetadata.status as RequestStatus
						const metadata = self.extractBlockMetadata(latestMetadata)

						if (status === RequestStatus.SOURCE) {
							// Only emit SOURCE if we haven't seen it or SOURCE_FINALIZED yet
							if (
								lastStatus !== RequestStatus.SOURCE &&
								lastStatus !== HyperClientStatus.SOURCE_FINALIZED
							) {
								controller.enqueue({
									status: metadata.status,
									metadata,
								})
								lastStatus = RequestStatus.SOURCE
							}

							// Get the latest state machine update for the source chain
							const sourceUpdate = await self.getClosestStateMachineUpdate(
								request.source,
								metadata.blockNumber,
								HYPERBRIDGE_TESTNET,
							)

							// Only emit SOURCE_FINALIZED if we haven't emitted it yet
							if (sourceUpdate && lastStatus !== HyperClientStatus.SOURCE_FINALIZED) {
								controller.enqueue({
									status: HyperClientStatus.SOURCE_FINALIZED,
									metadata: {
										blockHash: sourceUpdate.blockHash,
										blockNumber: sourceUpdate.height,
										chain: sourceUpdate.chain,
										transactionHash: sourceUpdate.transactionHash,
									},
								})
								lastStatus = HyperClientStatus.SOURCE_FINALIZED
								continue
							}

							// Only continue polling if we haven't reached SOURCE_FINALIZED
							if (lastStatus !== HyperClientStatus.SOURCE_FINALIZED) {
								await new Promise((resolve) => setTimeout(resolve, self.pollInterval))
								continue
							}
						}

						if (status === RequestStatus.HYPERBRIDGE_DELIVERED) {
							// Only emit DELIVERED and start hyperclient stream if we haven't seen FINALIZED yet
							if (lastStatus !== HyperClientStatus.HYPERBRIDGE_FINALIZED) {
								if (lastStatus !== RequestStatus.HYPERBRIDGE_DELIVERED) {
									controller.enqueue({
										status: metadata.status,
										metadata,
									})
									lastStatus = RequestStatus.HYPERBRIDGE_DELIVERED
								}

								try {
									const hyperClient = await getHyperClient(request.source, request.dest)
									const statusStream = await hyperClient.post_request_status_stream(
										{
											source: request.source,
											dest: request.dest,
											from: request.from,
											to: request.to,
											nonce: BigInt(request.nonce),
											timeoutTimestamp: BigInt(request.timeoutTimestamp),
											body: request.body,
										},
										{
											HyperbridgeVerified: BigInt(metadata.blockNumber),
										},
									)

									for await (const result of statusStream) {
										let status: MessageStatusWithMeta
										if (result instanceof Map) {
											status = Object.fromEntries(
												(result as any).entries(),
											) as MessageStatusWithMeta
										} else {
											status = result
										}

										if (status.kind === "HyperbridgeFinalized") {
											controller.enqueue({
												status: HyperClientStatus.HYPERBRIDGE_FINALIZED,
												metadata: {
													blockHash: status.block_hash,
													blockNumber: Number(status.block_number),
													chain: HYPERBRIDGE,
													transactionHash: status.transaction_hash,
													callData: status.calldata,
												},
											})
											lastStatus = HyperClientStatus.HYPERBRIDGE_FINALIZED
											break
										}
									}
								} catch (streamError) {
									console.error("Error in HyperClient stream:", streamError)
									break
								}
							}
							continue
						}

						if (self.isTerminalStatus(status)) {
							controller.enqueue({
								status: metadata.status,
								metadata,
							})
							controller.close()
							return
						}

						await new Promise((resolve) => setTimeout(resolve, self.pollInterval))
					} catch (error) {
						controller.error(error)
					}
				}
			},
		})
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
		return status === RequestStatus.TIMED_OUT || status === RequestStatus.DESTINATION
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
	private async getClosestStateMachineUpdate(
		statemachineId: string,
		height: number,
		chain: string,
	): Promise<StateMachineUpdate> {
		const response = await this.withRetry(() =>
			this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES, {
				statemachineId,
				height,
				chain,
			}),
		)

		const updates = response.stateMachineUpdateEvents.nodes

		// Get closest update >= height
		const closestUpdate = updates.filter((update) => update.height >= height).sort((a, b) => a.height - b.height)[0]

		return closestUpdate
	}
}
