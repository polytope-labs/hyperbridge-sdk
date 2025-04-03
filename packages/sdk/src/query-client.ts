import { GraphQLClient } from "graphql-request"
import { DEFAULT_LOGGER, REQUEST_STATUS_WEIGHTS, retryPromise } from "./utils"
import type { IndexerQueryClient, RequestResponse, RequestStatusKey, RequestWithStatus } from "./types"
import type { ConsolaInstance } from "consola"
import { REQUEST_STATUS } from "./queries"

export function createQueryClient(config: { url: string }) {
	return new GraphQLClient(config.url)
}

/**
 * Queries a request by CommitmentHash
 *
 * @example
 * import { createQueryClient, queryRequest } from "hyperbridge-sdk"
 *
 * const queryClient = createQueryClient({
 *   url: "http://localhost:3000", // URL of the Hyperbridge indexer API
 * })
 * const commitmentHash = "0x...."
 * const request = await queryRequest({ commitmentHash, queryClient })
 */
export function queryRequest(params: { commitmentHash: string; queryClient: IndexerQueryClient }) {
	return _queryRequestInternal(params)
}

/**
  * Queries a request by CommitmentHash

  * @param hash - Can be commitment
  * @returns Latest status and block metadata of the request
  */
export async function _queryRequestInternal(params: {
	commitmentHash: string
	queryClient: IndexerQueryClient
	logger?: ConsolaInstance
}): Promise<RequestWithStatus | undefined> {
	const { commitmentHash: hash, queryClient: client, logger: logger_ = DEFAULT_LOGGER } = params

	const logger = logger_.withTag("[queryRequest]")

	const response = await retryPromise(
		() => {
			return client.request<RequestResponse>(REQUEST_STATUS, {
				hash,
			})
		},
		{
			maxRetries: 3,
			backoffMs: 1000,
			logger,
			logMessage: `querying 'Request' with Statuses by CommitmentHash(${hash})`,
		},
	)

	const first_record = response.requests.nodes[0]
	if (!first_record) return

	logger.trace("`Request` found")
	const { statusMetadata, ...first_node } = first_record

	const statuses = structuredClone(statusMetadata.nodes).map((item) => ({
		status: item.status as any,
		metadata: {
			blockHash: item.blockHash,
			blockNumber: Number.parseInt(item.blockNumber),
			transactionHash: item.transactionHash,
		},
	}))

	// sort by ascending order
	const sorted = statuses.sort(
		(a, b) =>
			REQUEST_STATUS_WEIGHTS[a.status as RequestStatusKey] - REQUEST_STATUS_WEIGHTS[b.status as RequestStatusKey],
	)
	logger.trace("Statuses found", statuses)

	const request: RequestWithStatus = {
		...first_node,
		statuses: sorted,
	}

	return request
}
