import { GetRequest } from "@/configs/src/types"
import { ethers } from "ethers"
import { solidityKeccak256 } from "ethers/lib/utils"

export interface IGetRequestArgs {
	id: string
	source: string
	dest: string
	from: string
	keys: string[]
	nonce: bigint
	height: bigint
	context: string
	timeoutTimestamp: bigint
	fee: bigint
	blockNumber: string
	blockHash: string
	transactionHash: string
	blockTimestamp: bigint
}

export class GetRequestService {
	static async createGetRequest(args: IGetRequestArgs): Promise<GetRequest> {
		const {
			id,
			source,
			dest,
			from,
			keys,
			nonce,
			height,
			context,
			timeoutTimestamp,
			fee,
			blockNumber,
			blockHash,
			blockTimestamp,
			transactionHash,
		} = args
		let getRequest = GetRequest.create({
			id,
			source,
			dest,
			from,
			keys,
			nonce,
			height,
			context,
			timeoutTimestamp,
			fee,
			blockNumber,
			blockHash,
			transactionHash,
			blockTimestamp,
		})

		await getRequest.save()

		logger.info(
			`Saved GetRequest Event: ${JSON.stringify({
				id: getRequest.id,
			})}`,
		)

		return getRequest
	}

	/**
	 * Compute the getRequest commitment matching the solidity `encode` function for GetRequestEvent
	 */
	static computeRequestCommitment(
		source: string,
		dest: string,
		nonce: bigint,
		height: bigint,
		timeoutTimestamp: bigint,
		from: string,
		keys: string[],
		context: string,
	): string {
		logger.info(
			`Computing request commitment with details ${JSON.stringify({
				source,
				dest,
				nonce: nonce.toString(),
				height: height.toString(),
				timeoutTimestamp: timeoutTimestamp.toString(),
				from,
				keys,
				context,
			})}`,
		)

		// Concatenate all keys into a single bytes array
		const keysEncoding = keys.reduce((acc, key) => {
			return acc + key
		}, "")

		// Convert strings to bytes
		const sourceBytes = ethers.utils.toUtf8Bytes(source)
		const destBytes = ethers.utils.toUtf8Bytes(dest)
		const fromBytes = ethers.utils.toUtf8Bytes(from)
		const keysBytes = ethers.utils.toUtf8Bytes(keysEncoding)
		const contextBytes = ethers.utils.toUtf8Bytes(context)

		// Pack the data in the same order as the Solidity code
		const hash = solidityKeccak256(
			["bytes", "bytes", "uint64", "uint64", "uint64", "bytes", "bytes", "bytes"],
			[sourceBytes, destBytes, nonce, height, timeoutTimestamp, fromBytes, keysBytes, contextBytes],
		)

		return hash
	}
}
