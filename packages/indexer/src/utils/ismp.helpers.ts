import type { EthereumLog, EthereumResult } from "@subql/types-ethereum"
import { utils as ethersUtils } from "ethers"

// Known ISMP event signatures on EVMHost
const ISMP_EVENT_SIGNATURES = [
	"GetRequestEvent(string,string,address,bytes[],uint256,uint256,uint256,bytes,uint256)",
	"GetRequestHandled(bytes32,address)",
	"GetRequestTimeoutHandled(bytes32,string)",
	"PostRequestEvent(string,string,address,bytes,uint256,uint256,bytes,uint256)",
	"PostRequestHandled(bytes32,address)",
	"PostRequestTimeoutHandled(bytes32,string)",
	"PostResponseEvent(string,string,address,bytes,uint256,uint256,bytes,bytes,uint256,uint256)",
	"PostResponseHandled(bytes32,address)",
	"PostResponseTimeoutHandled(bytes32,string)",
]

const ISMP_EVENT_TOPICS = new Set(ISMP_EVENT_SIGNATURES.map((sig) => ethersUtils.id(sig).toLowerCase()))

export function findNextIsmpEventIndex(
	allLogs: ReadonlyArray<EthereumLog<EthereumResult>>,
	currentIndex: number,
	contractAddress: string,
): number | undefined {
	const addr = contractAddress.toLowerCase()
	let next: number | undefined
	for (const log of allLogs) {
		if (
			typeof log.logIndex === "number" &&
			log.logIndex > currentIndex &&
			log.address?.toLowerCase() === addr &&
			log.topics &&
			log.topics.length > 0 &&
			ISMP_EVENT_TOPICS.has(log.topics[0].toLowerCase())
		) {
			if (next === undefined || log.logIndex < next) {
				next = log.logIndex
			}
		}
	}
	return next
}

export function isWithinCurrentIsmpEventWindow(
	log: EthereumLog<EthereumResult>,
	currentEventIndex: number,
	nextEventIndex?: number,
): boolean {
	if (typeof log.logIndex !== "number") return false
	const afterCurrent = log.logIndex > currentEventIndex
	const beforeNext = nextEventIndex === undefined || log.logIndex < nextEventIndex
	return afterCurrent && beforeNext
}
