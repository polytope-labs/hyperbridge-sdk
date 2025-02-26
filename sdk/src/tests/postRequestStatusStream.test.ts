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
import { bscTestnet, sepolia } from "viem/chains"
import { IndexerClient } from "@/client"

import { HexString, RequestStatus } from "@/types"
import { postRequestCommitment } from "@/utils"

import ERC6160 from "@/abis/erc6160"
import PING_MODULE from "@/abis/pingModule"
import EVM_HOST from "@/abis/evmHost"
import HANDLER from "@/abis/handler"

describe("postRequestStatusStream", () => {
	it("should successfully stream the request status", async () => {
		const indexer = new IndexerClient({
			source: {
				consensusStateId: "BSC0",
				rpcUrl: process.env.BSC_CHAPEL!,
				stateMachineId: "EVM-97",
				host: process.env.BSC_CHAPEL_HOST!,
			},
			dest: {
				consensusStateId: "ETH0",
				rpcUrl: process.env.SEPOLIA!,
				stateMachineId: "EVM-11155111",
				host: process.env.SEPOLIA_HOST!,
			},
			hyperbridge: {
				consensusStateId: "PARA",
				stateMachineId: "KUSAMA-4009",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
			},
			pollInterval: 1000, // every second
		})

		const { bscTestnetClient, sepoliaHandler, bscPing, sepoliaClient, sepoliaHost } = await setUp()

		console.log("\n\nSending Post Request\n\n")

		const hash = await bscPing.write.ping([
			{
				dest: await sepoliaHost.read.host(),
				count: BigInt(1),
				fee: BigInt(0),
				module: process.env.PING_MODULE_ADDRESS! as HexString,
				timeout: BigInt(60 * 60),
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

		console.log({ request })

		const commitment = postRequestCommitment(request)

		const stream = indexer.postRequestStatusStream(commitment)

		for await (const status of stream) {
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
						`Status ${status.status}, Transaction: https://sepolia-optimism.etherscan.io/tx/${status.metadata.transactionHash}`,
					)
					const { args, functionName } = decodeFunctionData({
						abi: HANDLER.ABI,
						data: status.metadata.calldata,
					})

					try {
						const hash = await sepoliaHandler.write.handlePostRequests(args as any)
						await sepoliaClient.waitForTransactionReceipt({
							hash,
							confirmations: 1,
						})

						console.log(`Transaction submitted: https://sepolia-optimism.etherscan.io/tx/${hash}`)
					} catch (e) {
						console.error("Error self-relaying: ", e)
					}

					break
				}
				case RequestStatus.DESTINATION: {
					console.log(
						`Status ${status.status}, Transaction: https://sepolia-optimism.etherscan.io/tx/${status.metadata.transactionHash}`,
					)
					return
				}
			}
		}
	}, 3600_000)
})

async function setUp() {
	const account = privateKeyToAccount(process.env.PRIVATE_KEY as any)

	const bscWalletClient = createWalletClient({
		chain: bscTestnet,
		account,
		transport: http(process.env.BSC_CHAPEL),
	})

	const sepoliaWallet = createWalletClient({
		chain: sepolia,
		account,
		transport: http(process.env.SEPOLIA),
	})

	const bscTestnetClient = createPublicClient({
		chain: bscTestnet,
		transport: http(process.env.BSC_CHAPEL),
	})

	const sepoliaClient = createPublicClient({
		chain: sepolia,
		transport: http(process.env.SEPOLIA),
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

	const sepoliaPing = getContract({
		address: process.env.PING_MODULE_ADDRESS! as HexString,
		abi: PING_MODULE.ABI,
		client: sepoliaClient,
	})

	const sepoliaHostAddress = await sepoliaPing.read.host()

	const sepoliaHost = getContract({
		address: sepoliaHostAddress,
		abi: EVM_HOST.ABI,
		client: sepoliaClient,
	})

	const sepoliaHostParams = await sepoliaHost.read.hostParams()

	const sepoliaHandler = getContract({
		address: sepoliaHostParams.handler,
		abi: HANDLER.ABI,
		client: { public: sepoliaClient, wallet: sepoliaWallet },
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
		sepoliaHandler,
		bscHandler,
		bscPing,
		sepoliaClient,
		sepoliaHost,
	}
}
