import "log-timestamp"

import {
	createPublicClient,
	createWalletClient,
	decodeFunctionData,
	getContract,
	hexToBytes,
	http,
	parseAbi,
	parseEventLogs,
	toHex,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bscTestnet, gnosisChiado } from "viem/chains"

import { IndexerClient } from "@/client"
import { HexString, RequestStatus, TimeoutStatus } from "@/types"
import { getRequestCommitment } from "@/utils"

import ERC6160 from "@/abis/erc6160"
import PING_MODULE from "@/abis/pingModule"
import EVM_HOST from "@/abis/evmHost"
import HANDLER from "@/abis/handler"
import { latestStateMachineHeight } from "@/utils"

describe("GetRequest", () => {
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
				consensusStateId: "PAS0",
				stateMachineId: "KUSAMA-4009",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
			},
			url: "http://0.0.0.0:3100",
			pollInterval: 1_000, // every second
		})
	})

	it("should successfully stream and query the request status", async () => {
		const { bscTestnetClient, gnosisChiadoHandler, bscPing, gnosisChiadoClient, gnosisChiadoHost, bscIsmpHost } =
			await setUp()
		console.log("\n\nSending Get Request\n\n")

		const latestHeight = await latestStateMachineHeight(process.env.HYPERBRIDGE_GARGANTUA!, {
			stateId: { Evm: 10200 },
			consensusStateId: toHex("GNO0"),
		})

		const hash = await bscPing.write.dispatch([
			{
				source: await bscIsmpHost.read.host(),
				dest: await gnosisChiadoHost.read.host(),
				nonce: await bscIsmpHost.read.nonce(),
				from: process.env.PING_MODULE_ADDRESS! as `0x${string}`,
				timeoutTimestamp: BigInt(Math.floor(Date.now() / 1000) + 60 * 60),
				keys: [`0xFE9f23F0F2fE83b8B9576d3FC94e9a7458DdDD35`],
				height: latestHeight,
				context: "0x",
			},
		])

		const receipt = await bscTestnetClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log(`Transaction reciept: ${bscTestnet.blockExplorers.default.url}/tx/${hash}`)
		console.log("Block: ", receipt.blockNumber)

		// parse EvmHost GetRequestEvent emitted in the transcation logs
		const event = parseEventLogs({ abi: EVM_HOST.ABI, logs: receipt.logs })[0]

		if (event.eventName !== "GetRequestEvent") {
			throw new Error("Unexpected Event type")
		}

		const request = event.args
		console.log("GetRequestEvent", { request })
		const commitment = getRequestCommitment({ ...request, keys: [...request.keys] })
		console.log(commitment)

		for await (const status of indexer.getRequestStatusStream(commitment)) {
			console.log("query done")
			switch (status.status) {
				case RequestStatus.SOURCE_FINALIZED: {
					console.log(
						`Status ${status.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.metadata.transactionHash}`,
					)
					break
				}
				case RequestStatus.HYPERBRIDGE_DELIVERED: {
					console.log(
						`Status ${status.status}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.metadata.transactionHash}`,
					)
					break
				}
				case RequestStatus.HYPERBRIDGE_FINALIZED: {
					console.log(
						`Status ${status.status}, Transaction: https://gnosis-chiado.blockscout.com/tx/${status.metadata.transactionHash}`,
					)
					const { args, functionName } = decodeFunctionData({
						abi: HANDLER.ABI,
						data: status.metadata.calldata,
					})

					expect(functionName).toBe("handleGetResponses")

					try {
						const hash = await gnosisChiadoHandler.write.handleGetResponses(args as any)
						await gnosisChiadoClient.waitForTransactionReceipt({
							hash,
							confirmations: 1,
						})

						console.log(`Transaction submitted: https://gnosis-chiado.blockscout.com/tx/${hash}`)
					} catch (e) {
						console.error("Error self-relaying: ", e)
					}

					break
				}
				case RequestStatus.DESTINATION: {
					console.log(
						`Status ${status.status}, Transaction: https://gnosis-chiado.blockscout.com/tx/${status.metadata.transactionHash}`,
					)
					break
				}
			}
		}

		const req = await indexer.queryRequestWithStatus(commitment)
		console.log(JSON.stringify(req, null, 4))
		expect(req?.statuses.length).toBe(5)
	}, 1_000_000)
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
