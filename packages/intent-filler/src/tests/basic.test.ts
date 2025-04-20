import { IntentFiller } from "@/core/filler"
import { ChainClientManager, ChainConfigService } from "@/services"
import { BasicFiller } from "@/strategies/basic"
import { ChainConfig, DUMMY_PRIVATE_KEY, FillerConfig, HexString, Order, PaymentInfo, TokenInfo } from "hyperbridge-sdk"
import { describe, it, expect } from "vitest"
import { ConfirmationPolicy } from "@/config/confirmation-policy"
import { getContract, maxUint256, PublicClient, WalletClient } from "viem"
import { INTENT_GATEWAY_ABI } from "@/config/abis/IntentGateway"
import { privateKeyToAccount } from "viem/accounts"
import { bscTestnet } from "viem/chains"
import "./setup"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { ERC20_ABI } from "@/config/abis/ERC20"

describe("Basic", () => {
	let intentFiller: IntentFiller

	beforeAll(async () => {
		const { intentFiller: intentFillerInstance } = await setUp()
		intentFiller = intentFillerInstance
		intentFiller.start()
	})

	it("Should listen for orders", async () => {
		const {
			bscIntentGateway,
			gnosisChiadoIntentGateway,
			bscWalletClient,
			bscPublicClient,
			bscIsmpHost,
			gnosisChiadoIsmpHost,
			feeTokenBscAddress,
			feeTokenGnosisChiadoAddress,
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
	}, 1_000_000)
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
	const bscWalletClient = chainClientManager.getWalletClient(bscChapelId)
	const gnosisChiadoWalletClient = chainClientManager.getWalletClient(gnosisChiadoId)
	const bscPublicClient = chainClientManager.getPublicClient(bscChapelId)
	const gnosisChiadoPublicClient = chainClientManager.getPublicClient(gnosisChiadoId)
	const intentGatewayAddress = chainConfigService.getChainConfig(bscChapelId).intentGatewayAddress
	const feeTokenBscAddress = chainConfigService.getFeeTokenAddress(bscChapelId)
	const feeTokenGnosisChiadoAddress = chainConfigService.getFeeTokenAddress(gnosisChiadoId)
	const bscIsmpHostAddress = "0x8Aa0Dea6D675d785A882967Bf38183f6117C09b7" as HexString
	const gnosisChiadoIsmpHostAddress = "0x58a41b89f4871725e5d898d98ef4bf917601c5eb" as HexString

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
		client: bscPublicClient,
	})

	const gnosisChiadoIsmpHost = getContract({
		address: gnosisChiadoIsmpHostAddress,
		abi: EVM_HOST,
		client: gnosisChiadoPublicClient,
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
	}
}

async function approveTokens(
	walletClient: WalletClient,
	publicClient: PublicClient,
	tokenAddress: HexString,
	intentGatewayAddress: HexString,
) {
	const approval = await publicClient.readContract({
		abi: ERC20_ABI,
		address: tokenAddress,
		functionName: "allowance",
		args: [walletClient.account?.address as HexString, intentGatewayAddress],
		account: walletClient.account,
	})

	if (approval == 0n) {
		console.log("Approving tokens for test")
		const tx = await walletClient.writeContract({
			abi: ERC20_ABI,
			address: tokenAddress,
			functionName: "approve",
			args: [intentGatewayAddress, maxUint256],
			chain: bscTestnet,
			account: walletClient.account!,
		})

		console.log("Approved tokens for test:", tx)
	}
}
