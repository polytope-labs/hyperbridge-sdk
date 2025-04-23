import { IntentFiller } from "@/core/filler"
import { ChainClientManager, ChainConfigService, ContractInteractionService } from "@/services"
import { BasicFiller } from "@/strategies/basic"
import {
	ChainConfig,
	DispatchPost,
	DUMMY_PRIVATE_KEY,
	FillerConfig,
	HexString,
	Order,
	PaymentInfo,
	TokenInfo,
	IndexerClient,
	createQueryClient,
	postRequestCommitment,
	TimeoutStatus,
} from "hyperbridge-sdk"
import { describe, it, expect } from "vitest"
import { ConfirmationPolicy } from "@/config/confirmation-policy"
import {
	decodeFunctionData,
	encodePacked,
	getContract,
	keccak256,
	maxUint256,
	parseEventLogs,
	PublicClient,
	WalletClient,
} from "viem"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts"
import { bscTestnet, gnosisChiado } from "viem/chains"
import "./setup"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { HandlerV1_ABI } from "@/config/abis/HandlerV1"
describe("Basic", () => {
	let intentFiller: IntentFiller
	let indexer: IndexerClient
	beforeAll(async () => {
		const { bscIsmpHost, gnosisChiadoIsmpHost } = await setUp()
		const queryClient = createQueryClient({
			url: process.env.INDEXER_URL!,
		})

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
				host: gnosisChiadoIsmpHost.address,
			},
			hyperbridge: {
				consensusStateId: "PAS0",
				stateMachineId: "KUSAMA-4009",
				wsUrl: process.env.HYPERBRIDGE_GARGANTUA!,
			},
			queryClient: queryClient,
			pollInterval: 1_000,
		})

		const { intentFiller: intentFillerInstance } = await setUp()
		intentFiller = intentFillerInstance
		intentFiller.start()
	})

	it("Should listen, place order, fill order, and check if filled at the source chain", async () => {
		const {
			bscIntentGateway,
			gnosisChiadoIntentGateway,
			bscWalletClient,
			bscPublicClient,
			bscIsmpHost,
			gnosisChiadoIsmpHost,
			feeTokenBscAddress,

			gnosisChiadoPublicClient,
		} = await setUp()
		const inputs: TokenInfo[] = [
			{
				token: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount: 100n,
			},
		]
		const outputs: PaymentInfo[] = [
			{
				token: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount: 100n,
				beneficiary: "0x000000000000000000000000Ea4f68301aCec0dc9Bbe10F15730c59FB79d237E",
			},
		]

		const order = {
			user: "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString,
			sourceChain: await bscIsmpHost.read.host(),
			destChain: await gnosisChiadoIsmpHost.read.host(),
			deadline: 65337297n,
			nonce: 0n,
			fees: 1000000n,
			outputs,
			inputs,
			callData: "0x" as HexString,
		}

		await approveTokens(bscWalletClient, bscPublicClient, feeTokenBscAddress, bscIntentGateway.address)

		const orderDetectedPromise = new Promise<Order>((resolve) => {
			const eventMonitor = intentFiller.monitor
			if (!eventMonitor) {
				console.error("Event monitor not found on intentFiller")
				resolve({} as Order)
				return
			}

			eventMonitor.on("newOrder", (data: { order: Order }) => {
				console.log("Order detected by event monitor:", data.order.id)
				resolve(data.order)
			})
		})

		const hash = await bscIntentGateway.write.placeOrder([order], {
			account: privateKeyToAccount(process.env.PRIVATE_KEY as HexString),
			chain: bscTestnet,
			value: 100n,
		})

		const receipt = await bscPublicClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log("Order placed on BSC:", receipt.transactionHash)

		console.log("Waiting for event monitor to detect the order...")
		const detectedOrder = await orderDetectedPromise
		console.log("Order successfully detected by event monitor:", detectedOrder)

		const orderFilledPromise = new Promise<string>((resolve) => {
			const eventMonitor = intentFiller.monitor
			if (!eventMonitor) {
				console.error("Event monitor not found on intentFiller")
				resolve("")
				return
			}

			eventMonitor.on("orderFilled", (data: { orderId: string }) => {
				console.log("Order filled by event monitor:", data.orderId)
				resolve(data.orderId)
			})
		})

		const orderFilledId = await orderFilledPromise
		console.log("Order filled:", orderFilledId)

		let isFilled = await checkIfOrderFilled(
			orderFilledId as HexString,
			gnosisChiadoPublicClient,
			gnosisChiadoIntentGateway.address,
		)

		expect(isFilled).toBe(true)

		console.log("Checking if order is filled at the source chain...")
		await new Promise((resolve) => setTimeout(resolve, 30 * 1000))

		isFilled = await checkIfOrderFilled(orderFilledId as HexString, bscPublicClient, bscIntentGateway.address)
		let maxAttempts = 20
		while (!isFilled && maxAttempts > 0) {
			console.log("Order not filled at the source chain, retrying storage check in 30 seconds...")
			await new Promise((resolve) => setTimeout(resolve, 30 * 1000))
			isFilled = await checkIfOrderFilled(orderFilledId as HexString, bscPublicClient, bscIntentGateway.address)
			maxAttempts--
		}

		expect(isFilled).toBe(true)
	}, 1_000_000)

	it.only("Should timeout if the post request takes too long", async () => {
		const {
			bscIntentGateway,
			bscWalletClient,
			bscPublicClient,
			bscIsmpHost,
			gnosisChiadoIsmpHost,
			feeTokenBscAddress,
			contractInteractionService,
			gnosisChiadoPublicClient,
			bscHandler,
			gnosisChiadoWalletClient,
			feeTokenGnosisChiadoAddress,
		} = await setUp()

		// Stop the intent filler for this test, to make sure it doesn't make a post request as we do it manually
		intentFiller.stop()

		const inputs: TokenInfo[] = [
			{
				token: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount: 100n,
			},
		]
		const outputs: PaymentInfo[] = [
			{
				token: "0x0000000000000000000000000000000000000000000000000000000000000000",
				amount: 100n,
				beneficiary: "0x000000000000000000000000Ea4f68301aCec0dc9Bbe10F15730c59FB79d237E",
			},
		]

		const order = {
			user: "0x0000000000000000000000000000000000000000000000000000000000000000" as HexString,
			sourceChain: await bscIsmpHost.read.host(),
			destChain: await gnosisChiadoIsmpHost.read.host(),
			deadline: 65337297n,
			nonce: 0n,
			fees: 1000000n,
			outputs,
			inputs,
			callData: "0x" as HexString,
		}

		await approveTokens(bscWalletClient, bscPublicClient, feeTokenBscAddress, bscIntentGateway.address)

		let hash = await bscIntentGateway.write.placeOrder([order], {
			account: privateKeyToAccount(process.env.PRIVATE_KEY as HexString),
			chain: bscTestnet,
			value: 100n,
		})

		let receipt = await bscPublicClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log("Order placed on BSC:", receipt.transactionHash)

		// Once the order is placed, we must mimic the fill order on the destination chain by sending a post request
		// from the destination chain to the source chain with the constructed RequestBody

		const requestBody = contractInteractionService.constructRedeemEscrowRequestBody(order)
		console.log("Request body:", requestBody)

		const dipatchPost: DispatchPost = {
			dest: order.sourceChain,
			to: bscIntentGateway.address,
			body: requestBody,
			timeout: 2n,
			fee: 1000000n,
			payer: privateKeyToAddress(process.env.PRIVATE_KEY as HexString),
		}

		await approveTokens(
			gnosisChiadoWalletClient,
			gnosisChiadoPublicClient,
			feeTokenGnosisChiadoAddress,
			gnosisChiadoIsmpHost.address,
		)

		hash = await gnosisChiadoIsmpHost.write.dispatch([dipatchPost], {
			account: privateKeyToAccount(process.env.PRIVATE_KEY as HexString),
			chain: gnosisChiado,
		})

		receipt = await gnosisChiadoPublicClient.waitForTransactionReceipt({
			hash,
			confirmations: 1,
		})

		console.log("Post request dispatched on destination chain:", receipt.transactionHash)

		const event = parseEventLogs({ abi: EVM_HOST, logs: receipt.logs })[0]

		if (event.eventName !== "PostRequestEvent") {
			throw new Error("Unexpected Event type")
		}

		const request = event.args

		console.log("PostRequestEvent", { request })

		const commitment = postRequestCommitment(request)

		console.log("Post Request Commitment:", commitment.hash)

		const statusStream = indexer.postRequestStatusStream(commitment.hash)

		for await (const status of statusStream) {
			console.log(JSON.stringify(status, null, 4))

			if (status.status === TimeoutStatus.PENDING_TIMEOUT) {
				console.log("Request is now timed out", request.timeoutTimestamp)
			}
		}

		for await (const timeout of indexer.postRequestTimeoutStream(commitment.hash)) {
			console.log(JSON.stringify(timeout, null, 4))
			switch (timeout.status) {
				case TimeoutStatus.DESTINATION_FINALIZED_TIMEOUT:
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
					const { args, functionName } = decodeFunctionData({
						abi: HandlerV1_ABI,
						data: timeout.metadata!.calldata! as any,
					})

					expect(functionName).toBe("handlePostRequestTimeouts")

					try {
						const hash = await bscHandler.write.handlePostRequestTimeouts(args as any, {
							account: privateKeyToAccount(process.env.PRIVATE_KEY as HexString),
							chain: bscTestnet,
						})
						await bscPublicClient.waitForTransactionReceipt({
							hash,
							confirmations: 1,
						})

						console.log(`Transaction timeout submitted: https://testnet.bscscan.com/tx/${hash}`)
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

		const req = await indexer.queryRequestWithStatus(commitment.hash)
		console.log("Full status", JSON.stringify(req, null, 4))

		const hyperbridgeFinalizedStatus = req?.statuses.find(
			(status) => status.status === TimeoutStatus.HYPERBRIDGE_FINALIZED_TIMEOUT,
		)
		expect(hyperbridgeFinalizedStatus).toBeDefined()
		expect(hyperbridgeFinalizedStatus?.metadata.calldata).toBeDefined()
	}, 1200_000)
})

async function setUp() {
	const bscChapelId = "EVM-97"
	const gnosisChiadoId = "EVM-10200"

	const chains = [bscChapelId, gnosisChiadoId]

	let chainConfigService = new ChainConfigService()
	let chainConfigs: ChainConfig[] = chains.map((chain) => chainConfigService.getChainConfig(chain))

	let strategies = [new BasicFiller(process.env.PRIVATE_KEY as HexString)]

	const confirmationPolicy = new ConfirmationPolicy({
		"97": { "1000000000000000000": 1 },
		"10200": { "1000000000000000000": 1 },
	})

	const fillerConfig: FillerConfig = {
		confirmationPolicy: {
			getConfirmationBlocks: (chainId: number, amount: bigint) =>
				confirmationPolicy.getConfirmationBlocks(chainId, BigInt(amount)),
		},
		maxConcurrentOrders: 5,
		pendingQueueConfig: {
			maxRechecks: 10,
			recheckDelayMs: 30000,
		},
	}

	let intentFiller = new IntentFiller(chainConfigs, strategies, fillerConfig)

	const chainClientManager = new ChainClientManager(process.env.PRIVATE_KEY as HexString)
	const contractInteractionService = new ContractInteractionService(
		chainClientManager,
		process.env.PRIVATE_KEY as HexString,
	)
	const bscWalletClient = chainClientManager.getWalletClient(bscChapelId)
	const gnosisChiadoWalletClient = chainClientManager.getWalletClient(gnosisChiadoId)
	const bscPublicClient = chainClientManager.getPublicClient(bscChapelId)
	const gnosisChiadoPublicClient = chainClientManager.getPublicClient(gnosisChiadoId)
	const intentGatewayAddress = chainConfigService.getChainConfig(bscChapelId).intentGatewayAddress
	const feeTokenBscAddress = chainConfigService.getFeeTokenAddress(bscChapelId)
	const feeTokenGnosisChiadoAddress = chainConfigService.getFeeTokenAddress(bscChapelId)
	const bscIsmpHostAddress = "0x8Aa0Dea6D675d785A882967Bf38183f6117C09b7" as HexString
	const gnosisChiadoIsmpHostAddress = "0x58a41b89f4871725e5d898d98ef4bf917601c5eb" as HexString
	const bscHandlerAddress = "0x4638945E120846366cB7Abc08DB9c0766E3a663F" as HexString
	const bscIntentGateway = getContract({
		address: intentGatewayAddress as HexString,
		abi: INTENT_GATEWAY_ABI,
		client: { public: bscPublicClient, wallet: bscWalletClient },
	})

	const gnosisChiadoIntentGateway = getContract({
		address: intentGatewayAddress as HexString,
		abi: INTENT_GATEWAY_ABI,
		client: { public: gnosisChiadoPublicClient, wallet: gnosisChiadoWalletClient },
	})

	const bscIsmpHost = getContract({
		address: bscIsmpHostAddress,
		abi: EVM_HOST,
		client: { public: bscPublicClient, wallet: bscWalletClient },
	})

	const gnosisChiadoIsmpHost = getContract({
		address: gnosisChiadoIsmpHostAddress,
		abi: EVM_HOST,
		client: { public: gnosisChiadoPublicClient, wallet: gnosisChiadoWalletClient },
	})

	const bscHandler = getContract({
		address: bscHandlerAddress,
		abi: HandlerV1_ABI,
		client: { public: bscPublicClient, wallet: bscWalletClient },
	})

	return {
		intentFiller,
		chainClientManager,
		bscWalletClient,
		gnosisChiadoWalletClient,
		bscPublicClient,
		gnosisChiadoPublicClient,
		bscIntentGateway,
		gnosisChiadoIntentGateway,
		bscIsmpHostAddress,
		gnosisChiadoIsmpHostAddress,
		bscIsmpHost,
		gnosisChiadoIsmpHost,
		feeTokenBscAddress,
		feeTokenGnosisChiadoAddress,
		contractInteractionService,
		bscHandler,
	}
}

async function approveTokens(
	walletClient: WalletClient,
	publicClient: PublicClient,
	tokenAddress: HexString,
	spender: HexString,
) {
	const approval = await publicClient.readContract({
		abi: ERC20_ABI,
		address: tokenAddress,
		functionName: "allowance",
		args: [walletClient.account?.address as HexString, spender],
		account: walletClient.account,
	})

	if (approval == 0n) {
		console.log("Approving tokens for test")
		const tx = await walletClient.writeContract({
			abi: ERC20_ABI,
			address: tokenAddress,
			functionName: "approve",
			args: [spender, maxUint256],
			chain: walletClient.chain,
			account: walletClient.account!,
		})

		console.log("Approved tokens for test:", tx)
		// Wait for the 5 seconds, to make sure the transaction is mined
		await new Promise((resolve) => setTimeout(resolve, 5000))
	}
}

async function checkIfOrderFilled(
	commitment: HexString,
	client: PublicClient,
	intentGatewayAddress: HexString,
): Promise<boolean> {
	try {
		const mappingSlot = 5n

		const slot = keccak256(encodePacked(["bytes32", "uint256"], [commitment, mappingSlot]))

		const filledStatus = await client.getStorageAt({
			address: intentGatewayAddress,
			slot: slot,
		})

		console.log("Filled status:", filledStatus)
		return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
	} catch (error) {
		console.error(`Error checking if order filled:`, error)
		return false
	}
}

function createOrder() {}
