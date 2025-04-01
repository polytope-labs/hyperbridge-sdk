import { SubstrateEvent } from "@subql/types"
import fetch from "node-fetch"
import { bytesToHex, hexToBytes, toHex } from "viem"
import { GetResponseStatusMetadata, Status } from "@/configs/src/types"
import { formatChain, getHostStateMachine, isSubstrateChain } from "@/utils/substrate.helpers"
import { SUBSTRATE_RPC_URL } from "@/constants"
import { ResponseMetadata } from "@/utils/state-machine.helper"
import { replaceWebsocketWithHttp } from "./handleRequestEvent.handler"
import { Get } from "@/utils/substrate.helpers"
import { GetResponseService } from "@/services/getResponse.service"

export async function handleSubstrateResponseEvent(event: SubstrateEvent): Promise<void> {
	const host = getHostStateMachine(chainId)
	logger.info(`Saw Ismp.Response Event on ${host}`)

	if (!event.event.data) return

	const [dest_chain, source_chain, request_nonce, commitment, req_commitment] = event.event.data

	logger.info(
		`Handling ISMP Response Event: ${JSON.stringify({
			source_chain,
			dest_chain,
			request_nonce,
			commitment,
			req_commitment,
		})}`,
	)

	const sourceId = formatChain(source_chain.toString())
	const destId = formatChain(dest_chain.toString())

	logger.info(`Source ID: ${sourceId}`)
	logger.info(`Dest ID: ${destId}`)

	logger.info(
		`Chain Ids: ${JSON.stringify({
			sourceId,
			destId,
		})}`,
	)

	const method = {
		id: 1,
		jsonrpc: "2.0",
		method: "ismp_queryResponses",
		params: [[{ commitment: commitment.toString() }]],
	}

	const response = await fetch(replaceWebsocketWithHttp(SUBSTRATE_RPC_URL[host]), {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(method),
	})
	const data = await response.json()

	logger.info(`Response from calling ismp_queryResponses: ${JSON.stringify(data)}`)

	if (data.result.length === 0) {
		logger.error(`No responses found for commitment ${commitment.toString()}`)
		return
	}

	if (data.result[0].Get) {
		const getResponse = data.result[0].Get as Get

		let values: string[] = []

		for (const value of getResponse.values) {
			values.push(value.value)
		}

		logger.info(`Values Array: ${JSON.stringify(values)}`)

		await GetResponseService.findOrCreate({
			chain: host,
			commitment: commitment.toString(),
			request: req_commitment.toString(),
			response_message: values,
			responseTimeoutTimestamp: BigInt(Number(getResponse.get.timeoutTimestamp)),
			status: Status.SOURCE,
			blockNumber: event.block.block.header.number.toString(),
			blockHash: event.block.block.header.hash.toString(),
			transactionHash: event.extrinsic?.extrinsic.hash.toString() || "",
			blockTimestamp: BigInt(event.block.timestamp!.getTime()),
		})

		await GetResponseStatusMetadata.create({
			id: `${commitment.toString()}.${Status.SOURCE}`,
			responseId: commitment.toString(),
			status: Status.SOURCE,
			chain: host,
			timestamp: BigInt(event.block.timestamp!.getTime()),
			blockNumber: event.block.block.header.number.toString(),
			blockHash: event.block.block.header.hash.toString(),
			transactionHash: event.extrinsic?.extrinsic.hash.toString() || "",
			createdAt: new Date(Number(event.block.timestamp!.getTime())),
		})
	}

	// TODO: handle post response
}
