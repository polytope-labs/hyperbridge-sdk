import "log-timestamp"

import {
	createPublicClient,
	createWalletClient,
	decodeFunctionData,
	getContract,
	http,
	parseAbi,
	parseEventLogs,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bscTestnet, gnosisChiado } from "viem/chains"
import { IndexerClient } from "@/client"

import { HexString, RequestStatus, TimeoutStatus } from "@/types"
import { postRequestCommitment } from "@/utils"

import ERC6160 from "@/abis/erc6160"
import PING_MODULE from "@/abis/pingModule"
import EVM_HOST from "@/abis/evmHost"
import HANDLER from "@/abis/handler"

describe("postRequest", () => {
	let commitment: HexString
	let indexer: IndexerClient

	beforeAll(async () => {
		const { gnosisChiadoHost, bscIsmpHost } = await setUp()
		indexer = new IndexerClient({
			source: {
				consensusStateId: "BSC0",
				rpcUrl: process.env.BSC_CHAPEL!,
				stateMachineId: "EVM-97",
				host: bscIsmpHost.address,
			},
			dest: {
				consensusStateId: "GNO0",
				rpcUrl: process.env.GNOSIS_CHIADO!,
				stateMachineId: "EVM-10200",
				host: gnosisChiadoHost.address,
			},
			hyperbridge: {
				consensusStateId: "PARA",
				stateMachineId: "KUSAMA-4009",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
			},
			pollInterval: 1_000, // every second
		})
	})

	// it("should successfully stream the request status", async () => {
	// 	const { bscTestnetClient, gnosisChiadoHandler, bscPing, gnosisChiadoClient, gnosisChiadoHost } = await setUp()
	// 	console.log("\n\nSending Post Request\n\n")

	// 	const hash = await bscPing.write.ping([
	// 		{
	// 			dest: await gnosisChiadoHost.read.host(),
	// 			count: BigInt(1),
	// 			fee: BigInt(0),
	// 			module: process.env.PING_MODULE_ADDRESS! as HexString,
	// 			timeout: BigInt(60 * 60),
	// 		},
	// 	])

	// 	const receipt = await bscTestnetClient.waitForTransactionReceipt({
	// 		hash,
	// 		confirmations: 1,
	// 	})

	// 	console.log(`Transaction reciept: ${bscTestnet.blockExplorers.default.url}/tx/${hash}`)
	// 	console.log("Block: ", receipt.blockNumber)

	// 	// parse EvmHost PostRequestEvent emitted in the transcation logs
	// 	const event = parseEventLogs({ abi: EVM_HOST.ABI, logs: receipt.logs })[0]

	// 	if (event.eventName !== "PostRequestEvent") {
	// 		throw new Error("Unexpected Event type")
	// 	}

	// 	const request = event.args

	// 	console.log("PostRequestEvent", { request })

	// 	commitment = postRequestCommitment(request)
	// 	const stream = indexer.postRequestStatusStream(commitment)

	// 	for await (const status of stream) {
	// 		switch (status.status) {
	// 			case RequestStatus.SOURCE_FINALIZED: {
	// 				console.log(
	// 					`Status ${status.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.metadata.transactionHash}`,
	// 				)
	// 				break
	// 			}
	// 			case RequestStatus.HYPERBRIDGE_DELIVERED: {
	// 				console.log(
	// 					`Status ${status.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.metadata.transactionHash}`,
	// 				)
	// 				break
	// 			}
	// 			case RequestStatus.HYPERBRIDGE_FINALIZED: {
	// 				console.log(
	// 					`Status ${status.status}, Transaction: https://gnosis-chiado.blockscout.com/tx/${status.metadata.transactionHash}`,
	// 				)
	// 				const { args, functionName } = decodeFunctionData({
	// 					abi: HANDLER.ABI,
	// 					data: status.metadata.calldata,
	// 				})

	// 				try {
	// 					const hash = await gnosisChiadoHandler.write.handlePostRequests(args as any)
	// 					await gnosisChiadoClient.waitForTransactionReceipt({
	// 						hash,
	// 						confirmations: 1,
	// 					})

	// 					console.log(`Transaction submitted: https://gnosis-chiado.blockscout.com/tx/${hash}`)
	// 				} catch (e) {
	// 					console.error("Error self-relaying: ", e)
	// 				}

	// 				break
	// 			}
	// 			case RequestStatus.DESTINATION: {
	// 				console.log(
	// 					`Status ${status.status}, Transaction: https://gnosis-chiado.blockscout.com/tx/${status.metadata.transactionHash}`,
	// 				)
	// 				return
	// 			}
	// 		}
	// 	}
	// }, 600_000)

	// it("Should query the full request with statuses", async () => {
	// 	const request = await indexer.queryRequestWithStatus(commitment)

	// 	expect(request?.statuses.length).toBe(5)

	// 	console.log(JSON.stringify(request, null, 4))
	// })

	it("should stream the timeout status", async () => {
		const { bscTestnetClient, bscHandler, bscPing, gnosisChiadoHost } = await setUp()
		console.log("\n\nSending Post Request\n\n")

		const hash = await bscPing.write.ping([
			{
				dest: await gnosisChiadoHost.read.host(),
				count: BigInt(1),
				fee: BigInt(0),
				module: process.env.PING_MODULE_ADDRESS! as HexString,
				timeout: BigInt(3 * 60), // so it can timeout
			},
		])

		const receipt = await bscTestnetClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log(`Transaction reciept: ${bscTestnet.blockExplorers.default.url}/tx/${hash}`)
		console.log("Block: ", receipt.blockNumber)

		// parse EvmHost PostRequestEvent emitted in the transcation logs
		const event = parseEventLogs({ abi: EVM_HOST.ABI, logs: receipt.logs })[0]

		if (event.eventName !== "PostRequestEvent") {
			throw new Error("Unexpected Event type")
		}

		const request = event.args

		console.log("PostRequestEvent", { request })

		commitment = postRequestCommitment(request)
		const statusStream = indexer.postRequestStatusStream(commitment)

		for await (const status of statusStream) {
			console.log(JSON.stringify(status, null, 4))

			if (status.status === TimeoutStatus.PENDING_TIMEOUT) {
				console.log("Request is now timed out", request.timeoutTimestamp)
			}
		}

		console.log("Starting timeout stream")

		const timeoutStream = indexer.postRequestTimeoutStream(commitment)
		for await (const timeout of timeoutStream) {
			console.log(JSON.stringify(timeout, null, 4))
			switch (timeout.status) {
				case TimeoutStatus.DESTINATION_FINALIZED:
					console.log(
						`Status ${timeout.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${timeout.metadata?.transactionHash}`,
					)
					break
				case TimeoutStatus.HYPERBRIDGE_TIMED_OUT:
					console.log(
						`Status ${timeout.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${timeout.metadata?.transactionHash}`,
					)
					break
				case TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT: {
					console.log(
						`Status ${timeout.status}, Transaction: https://testnet.bscscan.com/tx/${timeout.metadata?.transactionHash}`,
					)
					const { args } = decodeFunctionData({
						abi: HANDLER.ABI,
						data: timeout.metadata!.calldata! as any,
					})

					try {
						const hash = await bscHandler.write.handlePostRequests(args as any)
						await bscTestnetClient.waitForTransactionReceipt({
							hash,
							confirmations: 1,
						})

						console.log(`Transaction submitted: https://testnet.bscscan.com/tx/${hash}`)
					} catch (e) {
						console.error("Error self-relaying: ", e)
					}

					break
				}
				default:
					console.log("Unknown timeout status")
					break
			}
		}
	}, 1200_000)
})

async function setUp() {
	const account = privateKeyToAccount(process.env.PRIVATE_KEY as any)

	const bscWalletClient = createWalletClient({
		chain: bscTestnet,
		account,
		transport: http(process.env.BSC_CHAPEL),
	})

	const gnosisChiadoWallet = createWalletClient({
		chain: gnosisChiado,
		account,
		transport: http(process.env.GNOSIS_CHIADO),
	})

	const bscTestnetClient = createPublicClient({
		chain: bscTestnet,
		transport: http(process.env.BSC_CHAPEL),
	})

	const gnosisChiadoClient = createPublicClient({
		chain: gnosisChiado,
		transport: http(process.env.GNOSIS_CHIADO),
	})

	const bscPing = getContract({
		address: process.env.PING_MODULE_ADDRESS! as HexString,
		abi: PING_MODULE.ABI,
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	const bscIsmpHostAddress = await bscPing.read.host()

	const bscIsmpHost = getContract({
		address: bscIsmpHostAddress,
		abi: EVM_HOST.ABI,
		client: bscTestnetClient,
	})

	const bscHostParams = await bscIsmpHost.read.hostParams()

	const bscHandler = getContract({
		address: bscHostParams.handler,
		abi: HANDLER.ABI,
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	const bscFeeToken = getContract({
		address: bscHostParams.feeToken,
		abi: ERC6160.ABI,
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	const gnosisChiadoPing = getContract({
		address: process.env.PING_MODULE_ADDRESS! as HexString,
		abi: PING_MODULE.ABI,
		client: gnosisChiadoClient,
	})

	const gnosisChiadoHostAddress = await gnosisChiadoPing.read.host()

	const gnosisChiadoHost = getContract({
		address: gnosisChiadoHostAddress,
		abi: EVM_HOST.ABI,
		client: gnosisChiadoClient,
	})

	const gnosisChiadoHostParams = await gnosisChiadoHost.read.hostParams()

	const gnosisChiadoHandler = getContract({
		address: gnosisChiadoHostParams.handler,
		abi: HANDLER.ABI,
		client: { public: gnosisChiadoClient, wallet: gnosisChiadoWallet },
	})

	const tokenFaucet = getContract({
		address: "0x17d8cc0859fbA942A7af243c3EBB69AbBfe0a320",
		abi: parseAbi(["function drip(address token) public"]),
		client: { public: bscTestnetClient, wallet: bscWalletClient },
	})

	return {
		bscTestnetClient,
		bscFeeToken,
		account,
		tokenFaucet,
		gnosisChiadoHandler,
		bscHandler,
		bscPing,
		gnosisChiadoClient,
		gnosisChiadoHost,
		bscIsmpHost,
	}
}
