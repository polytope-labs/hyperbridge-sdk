import { SubstrateEvent } from "@subql/types"
import fetch from "node-fetch"
import { bytesToHex, hexToBytes, toHex } from "viem"

import { ResponseService } from "@/services/response.service"
import { ResponseStatusMetadata, Status } from "@/configs/src/types"
import { formatChain, getHostStateMachine, isSubstrateChain } from "@/utils/substrate.helpers"
import { SUBSTRATE_RPC_URL } from "@/constants"
import { ResponseMetadata } from "@/utils/state-machine.helper"

export async function handleSubstrateResponseEvent(event: SubstrateEvent): Promise<void> {
	logger.info(`Saw Ismp.Response Event on ${getHostStateMachine(chainId)}`)

	if (!event.event.data) return

	const [source_chain, dest_chain, request_nonce, commitment, req_commitment] = event.event.data

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

	logger.info(
		`Chain Ids: ${JSON.stringify({
			sourceId,
			destId,
		})}`,
	)

	if (!isSubstrateChain(sourceId)) {
		logger.error(`Skipping hyperbridge aggregated response`)
		return
	}

	if (!SUBSTRATE_RPC_URL[sourceId]) {
		logger.error(`No WS URL found for chain ${sourceId}`)
		return
	}

	const method = {
		id: 1,
		jsonrpc: "2.0",
		method: "ismp_queryResponses",
		params: [[{ commitment: commitment.toString() }]],
	}

	const response = await fetch(replaceWebsocketWithHttp(SUBSTRATE_RPC_URL[sourceId]), {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(method),
	})
	const data = await response.json()

	if (data.result.length === 0) {
		logger.error(`No responses found for commitment ${commitment.toString()}`)
		return
	}

	const postResponse = data.result[0].Post

	if (!postResponse) {
		logger.error(`Response not found for commitment ${commitment.toString()}`)
		return
	}

	const {
		response: response_message,
		request: request_message,
		timeoutTimestamp: responseTimeoutTimestamp,
	} = postResponse
	const prefix = toHex(":child_storage:default:ISMP")
	const key = bytesToHex(
		new Uint8Array([
			...new TextEncoder().encode("ResponseCommitments"),
			...hexToBytes(commitment.toString() as any),
		]),
	)

	const metadataResponse = await fetch(replaceWebsocketWithHttp(SUBSTRATE_RPC_URL[sourceId]), {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			id: 1,
			jsonrpc: "2.0",
			method: "childstate_getStorage",
			params: [prefix, key],
		}),
	})
	const storageValue = (await metadataResponse.json()).result as `0x${string}` | undefined

	let fee = BigInt(0)
	if (typeof storageValue === "string") {
		const metadata = ResponseMetadata.dec(hexToBytes(storageValue))
		fee = BigInt(Number(metadata.fee.fee))
	}

	const host = getHostStateMachine(chainId)
	await ResponseService.findOrCreate({
		chain: host,
		commitment: commitment.toString(),
		request: request_message,
		response_message,
		responseTimeoutTimestamp: BigInt(Number(responseTimeoutTimestamp)),
		status: Status.SOURCE,
		blockNumber: event.block.block.header.number.toString(),
		blockHash: event.block.block.header.hash.toString(),
		transactionHash: event.extrinsic?.extrinsic.hash.toString() || "",
		blockTimestamp: BigInt(event.block?.timestamp!.getTime()),
	})

	// Always create a new status metadata entry
	let responseStatusMetadata = ResponseStatusMetadata.create({
		id: `${commitment.toHex()}.${Status.SOURCE}`,
		responseId: commitment.toHex(),
		status: Status.SOURCE,
		chain: host,
		timestamp: BigInt(event.block?.timestamp!.getTime()),
		blockNumber: event.block.block.header.number.toString(),
		blockHash: event.block.block.header.hash.toString(),
		transactionHash: event.extrinsic?.extrinsic.hash.toString() || "",
		createdAt: new Date(Number(event.block?.timestamp!.getTime())),
	})

	await responseStatusMetadata.save()
}

export function replaceWebsocketWithHttp(url: string): string {
	if (url.startsWith("ws://")) {
		return url.replace("ws://", "http://")
	} else if (url.startsWith("wss://")) {
		return url.replace("wss://", "https://")
	}
	return url
}
