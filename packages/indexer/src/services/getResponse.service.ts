import { solidityKeccak256 } from "ethers/lib/utils"
import { GetResponse, GetResponseStatusMetadata, Status } from "@/configs/src/types"

export interface ICreateGetResponseArgs {
	chain: string
	commitment: string
	response_message?: string[]
	responseTimeoutTimestamp?: bigint | undefined
	request?: string | undefined
	status: Status
	blockNumber: string
	blockHash: string
	transactionHash: string
	blockTimestamp: bigint
}

export interface IUpdateResponseStatusArgs {
	commitment: string
	status: Status
	blockNumber: string
	blockHash: string
	transactionHash: string
	timeoutHash?: string
	blockTimestamp: bigint
	chain: string
}

export class GetResponseService {
	/**
	 * Finds a response enitity and creates a new one if it doesn't exist
	 */
	static async findOrCreate(args: ICreateGetResponseArgs): Promise<GetResponse> {
		const {
			chain,
			commitment,
			request,
			response_message,
			responseTimeoutTimestamp,
			status,
			blockNumber,
			blockHash,
			blockTimestamp,
			transactionHash,
		} = args
		let response = await GetResponse.get(commitment)

		logger.info(
			`Creating GetResponse Event: ${JSON.stringify({
				commitment,
				transactionHash,
				status,
			})}`,
		)

		if (typeof response === "undefined") {
			response = GetResponse.create({
				id: commitment,
				commitment,
				chain,
				requestId: request,
				response_message: response_message || [""],
				responseTimeoutTimestamp,
				createdAt: new Date(Number(blockTimestamp)),
			})

			await response.save()

			logger.info(
				`Created new get response with details ${JSON.stringify({
					commitment,
					transactionHash,
					status,
				})}`,
			)

			let responseStatusMetadata = GetResponseStatusMetadata.create({
				id: `${commitment}.${status}`,
				responseId: commitment,
				status,
				chain,
				timestamp: blockTimestamp,
				blockNumber,
				blockHash,
				transactionHash,
				createdAt: new Date(Number(blockTimestamp)),
			})

			await responseStatusMetadata.save()
		}

		return response
	}

	/**
	 * Update the status of a get response
	 * Also adds a new entry to the get response status metadata
	 */
	static async updateStatus(args: IUpdateResponseStatusArgs): Promise<void> {
		const { commitment, blockNumber, blockHash, blockTimestamp, status, transactionHash, chain } = args

		let response = await GetResponse.get(commitment)

		if (response) {
			let responseStatusMetadata = GetResponseStatusMetadata.create({
				id: `${commitment}.${status}`,
				responseId: commitment,
				status,
				chain,
				timestamp: blockTimestamp,
				blockNumber,
				blockHash,
				transactionHash,
				createdAt: new Date(Number(blockTimestamp)),
			})

			await responseStatusMetadata.save()
		} else {
			await this.findOrCreate({
				chain,
				commitment,
				blockHash,
				blockNumber,
				blockTimestamp,
				status,
				transactionHash,
				request: undefined,
				responseTimeoutTimestamp: undefined,
				response_message: undefined,
			})

			logger.error(
				`Attempted to update status of non-existent response with commitment: ${commitment} in transaction: ${transactionHash}`,
			)

			logger.info(
				`Created new response while attempting response update with details: ${JSON.stringify({
					commitment,
					transactionHash,
					status,
				})}`,
			)
		}
	}

	/**
	 * Compute the get response commitment
	 */
	static computeResponseCommitment(getRequestCommitment: string, keys: string[], values: string[]): string {
		let keyValueEncoding = keys
			.map((key, index) => {
				return `${key.slice(2)}${values[index].slice(2)}`
			})
			.join(",")

		return solidityKeccak256(["bytes", "bytes"], [getRequestCommitment, keyValueEncoding])
	}

	/**
	 * Find responses by chain
	 */
	static async findByChain(chain: string) {
		return GetResponse.getByChain(chain, {
			orderBy: "id",
			limit: -1,
		})
	}

	/**
	 * Find a response by commitment
	 */
	static async findByCommitment(commitment: string) {
		// Since commitment is the ID, we can just use get()
		return GetResponse.get(commitment)
	}

	/**
	 * Find responses by request ID
	 */
	static async findByRequestId(requestId: string) {
		return GetResponse.getByRequestId(requestId, {
			orderBy: "id",
			limit: -1,
		})
	}
}
