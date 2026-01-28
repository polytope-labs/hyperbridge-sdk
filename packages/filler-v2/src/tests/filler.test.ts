/**
 * Filler V2 Integration Tests
 *
 * These tests verify the full order lifecycle with IntentGatewayV2:
 *
 * Test Flow: BSC Chapel (source) -> Polygon Amoy (destination)
 * Token: USDC on both chains
 * Mode: Solver Selection ON (filler submits bids to Hyperbridge)
 *
 * Architecture Flow (Solver Selection ON):
 * 1. User places order on SOURCE chain (BSC Chapel) - tokens escrowed
 * 2. Filler detects OrderPlaced event via EventMonitor
 * 3. Filler evaluates order profitability
 * 4. Filler submits bid (PackedUserOperation) to Hyperbridge pallet-intent-coprocessor
 * 5. User SDK watches Hyperbridge for bids, selects best bid, signs with session key
 * 6. User SDK submits final UserOp to ERC-4337 bundler on destination chain
 * 7. Bundler executes fillOrder on destination chain (Polygon Amoy)
 * 8. Settlement message sent via Hyperbridge to release escrowed tokens to filler
 *
 * Prerequisites:
 * - IntentGatewayV2 contracts deployed on BSC Chapel (97) and Polygon Amoy (80002)
 * - Filler wallet has sufficient USDC tokens on Polygon Amoy (destination)
 * - User has approved USDC tokens for IntentGatewayV2 on BSC Chapel (source)
 * - ERC-4337 bundler running on destination chain
 * - Environment variables set in .env.local:
 *   - PRIVATE_KEY: EVM private key for filler/user
 *   - BSC_CHAPEL: BSC Chapel RPC URL
 *   - POLYGON_AMOY: Polygon Amoy RPC URL
 *   - HYPERBRIDGE_GARGANTUA: Hyperbridge WebSocket URL (required for solver support)
 *   - SECRET_PHRASE: Substrate mnemonic (required for solver support)
 *   - BUNDLER_URL: ERC-4337 bundler URL for destination chain (optional)
 */

import { IntentFiller } from "@/core/filler"
import {
	CacheService,
	ChainClientManager,
	ContractInteractionService,
	FillerConfigService,
	type UserProvidedChainConfig,
	type FillerConfig as FillerServiceConfig,
} from "@/services"
import { BasicFiller } from "@/strategies/basic"
import {
	type ChainConfig,
	type FillerConfig,
	type HexString,
	type OrderV2,
	type TokenInfoV2,
	bytes20ToBytes32,
	orderV2Commitment,
	EvmChain,
	IntentGatewayV2,
	IntentsCoprocessor,
} from "@hyperbridge/sdk"
import { describe, it, expect } from "vitest"
import { ConfirmationPolicy } from "@/config/confirmation-policy"
import {
	getContract,
	maxUint256,
	parseUnits,
	type PublicClient,
	type WalletClient,
	encodePacked,
	keccak256,
	toHex,
	parseEventLogs,
} from "viem"
import { INTENT_GATEWAY_V2_ABI } from "@/config/abis/IntentGatewayV2"
import { privateKeyToAccount } from "viem/accounts"
import { bscTestnet } from "viem/chains"
import "./setup"
import { ERC20_ABI } from "@/config/abis/ERC20"
import { EVM_HOST } from "@/config/abis/EvmHost"
import { Decimal } from "decimal.js"

describe.sequential("Filler V2 - Solver Selection ON", () => {
	/**
	 * Test: Full order lifecycle with solver selection ON
	 *
	 * Flow:
	 * 1. User places order on BSC Chapel (source)
	 * 2. Filler detects order and submits bid to Hyperbridge
	 * 3. User SDK (executeIntentOrder) selects bid and submits to bundler
	 * 4. Order filled on Polygon Amoy (destination)
	 */
	it("Should place order, filler submits bid, user selects bid, order filled", async () => {
		const {
			bscIntentGatewayV2,
			polygonAmoyPublicClient,
			bscPublicClient,
			chainConfigs,
			fillerConfig,
			chainConfigService,
			bscChapelId,
			polygonAmoyId,
			bscWalletClient,
			contractService,
		} = await setUp()

		// Create the filler with shared services
		const privateKey = process.env.PRIVATE_KEY as HexString
		const sharedCacheService = new CacheService()
		const chainClientManager = new ChainClientManager(chainConfigService, privateKey)
		const localContractService = new ContractInteractionService(
			chainClientManager,
			privateKey,
			chainConfigService,
			sharedCacheService,
		)

		const strategies = [
			new BasicFiller(privateKey, chainConfigService, chainClientManager, localContractService, 50), // 50 bps = 0.5%
		]

		const intentFiller = new IntentFiller(
			chainConfigs,
			strategies,
			fillerConfig,
			chainConfigService,
			chainClientManager,
			localContractService,
			privateKey,
		)

		// Initialize and start the filler
		await intentFiller.initialize()
		intentFiller.start()

		// =====================================================================
		// Step 1: User prepares and places order on BSC Chapel (source chain)
		// =====================================================================
		const sourceUsdc = chainConfigService.getUsdcAsset(bscChapelId)
		const destUsdc = chainConfigService.getUsdcAsset(polygonAmoyId)

		const sourceUsdcDecimals = await contractService.getTokenDecimals(sourceUsdc, bscChapelId)
		const destUsdcDecimals = await contractService.getTokenDecimals(destUsdc, polygonAmoyId)
		const amount = parseUnits("1", sourceUsdcDecimals)

		const inputs: TokenInfoV2[] = [{ token: bytes20ToBytes32(sourceUsdc), amount }]
		const outputs: TokenInfoV2[] = [
			{
				token: bytes20ToBytes32(destUsdc),
				amount: amount - parseUnits("0.94", destUsdcDecimals),
			},
		]

		const beneficiaryAddress = privateKeyToAccount(privateKey).address
		const beneficiary = bytes20ToBytes32(beneficiaryAddress)

		let order: OrderV2 = {
			user: bytes20ToBytes32(beneficiaryAddress),
			source: toHex(bscChapelId),
			destination: toHex(polygonAmoyId),
			deadline: 12545151568145n,
			nonce: 0n,
			fees: parseUnits("1", 18),
			session: "0x0000000000000000000000000000000000000000" as HexString,
			predispatch: { assets: [], call: "0x" as HexString },
			inputs,
			output: { beneficiary, assets: outputs, call: "0x" as HexString },
		}

		// Create SDK helper with IntentsCoprocessor and bundler URL for full solver selection flow
		const hyperbridgeWsUrl = process.env.HYPERBRIDGE_GARGANTUA!
		const substrateKey = process.env.SECRET_PHRASE!
		const bundlerUrl = process.env.BUNDLER_URL || "" // Default Pimlico for Polygon Amoy

		const intentsCoprocessor = await IntentsCoprocessor.connect(hyperbridgeWsUrl, substrateKey)

		const bscEvmChain = new EvmChain({
			chainId: 97,
			host: chainConfigService.getHostAddress(bscChapelId),
			rpcUrl: chainConfigService.getRpcUrl(bscChapelId),
		})

		const polygonAmoyEvmChain = new EvmChain({
			chainId: 80002,
			host: chainConfigService.getHostAddress(polygonAmoyId),
			rpcUrl: chainConfigService.getRpcUrl(polygonAmoyId),
		})

		// SDK helper with IntentsCoprocessor and bundler for user-side bid selection
		const userSdkHelper = new IntentGatewayV2(bscEvmChain, polygonAmoyEvmChain, intentsCoprocessor, bundlerUrl)

		// Prepare order (generates session key and stores it)
		const { orderCalldata, privateKey: sessionPrivateKey } = await userSdkHelper.preparePlaceOrder(order)

		// Approve tokens
		const feeToken = await contractService.getFeeTokenWithDecimals(bscChapelId)
		await approveTokens(bscWalletClient, bscPublicClient, feeToken.address, bscIntentGatewayV2.address)
		await approveTokens(bscWalletClient, bscPublicClient, sourceUsdc, bscIntentGatewayV2.address)

		// Set up promise to capture commitment from filler's event monitor
		// The filler calculates commitment from on-chain data using callTracer
		const commitmentPromise = new Promise<HexString>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Timeout waiting for filler to detect order"))
			}, 120_000) // 2 minutes timeout

			intentFiller.monitor.once("newOrder", ({ order: detectedOrder }) => {
				clearTimeout(timeout)
				console.log("Filler detected order with commitment:", detectedOrder.id)
				resolve(detectedOrder.id as HexString)
			})
		})

		// Place the order on BSC Chapel
		const orderTxHash = await bscWalletClient.sendTransaction({
			to: bscIntentGatewayV2.address,
			data: orderCalldata,
			account: privateKeyToAccount(privateKey),
			chain: bscTestnet,
		})

		console.log("Order placed on BSC Chapel, tx:", orderTxHash)

		// Wait for transaction receipt and extract actual nonce from OrderPlaced event
		const receipt = await bscPublicClient.waitForTransactionReceipt({
			hash: orderTxHash,
			confirmations: 1,
		})

		const orderPlacedEvent = parseEventLogs({ abi: INTENT_GATEWAY_V2_ABI, logs: receipt.logs }).find(
			(e) => e.eventName === "OrderPlaced",
		)

		if (!orderPlacedEvent || orderPlacedEvent.eventName !== "OrderPlaced") {
			throw new Error("OrderPlaced event not found in transaction logs")
		}

		// Update order.nonce with the actual nonce emitted in the event
		order.nonce = orderPlacedEvent.args.nonce
		console.log("Actual nonce from OrderPlaced event:", order.nonce)

		// Wait for filler to detect the order and get the commitment
		const commitment = await commitmentPromise
		console.log("Got commitment from filler:", commitment)

		// =====================================================================
		// Step 2: Use SDK's executeIntentOrder to handle the full flow
		// This generator function:
		// - Waits for order confirmation
		// - Polls Hyperbridge for bids (submitted by filler)
		// - Selects best bid and signs with session key
		// - Submits to bundler
		// =====================================================================
		console.log("Starting executeIntentOrder flow (waiting for bids from filler)...")

		let userOpHash: HexString | undefined
		let selectedSolver: HexString | undefined

		for await (const status of userSdkHelper.executeIntentOrder(
			{
				order,
				orderTxHash,
				minBids: 1, // Wait for at least 1 bid
				bidTimeoutMs: 120_000, // 2 minutes to wait for bids
				pollIntervalMs: 5_000, // Poll every 5 seconds
			},
			commitment,
			sessionPrivateKey,
		)) {
			console.log(`Status: ${status.status}`, status.metadata)

			switch (status.status) {
				case "ORDER_SUBMITTED":
					console.log("Order submitted, waiting for confirmation...")
					break
				case "ORDER_CONFIRMED":
					console.log("Order confirmed on source chain")
					break
				case "AWAITING_BIDS":
					console.log("Waiting for filler bids on Hyperbridge...")
					break
				case "BIDS_RECEIVED":
					console.log(`Received ${status.metadata.bidCount} bid(s)`)
					break
				case "BID_SELECTED":
					selectedSolver = status.metadata.selectedSolver as HexString
					userOpHash = status.metadata.userOpHash as HexString
					console.log(`Selected solver: ${selectedSolver}`)
					break
				case "USEROP_SUBMITTED":
					console.log(`UserOp submitted to bundler, hash: ${status.metadata.userOpHash}`)
					break
				case "FAILED":
					throw new Error(`Order execution failed: ${status.metadata.error}`)
			}
		}

		expect(userOpHash).toBeDefined()
		expect(selectedSolver).toBeDefined()

		// =====================================================================
		// Step 3: Wait for order to be filled on destination chain
		// =====================================================================
		console.log("Waiting for order to be filled on Polygon Amoy...")

		// Poll for filled status (the bundler executes the UserOp which calls fillOrder)
		let isFilled = false
		const maxAttempts = 60 // 5 minutes with 5s intervals
		for (let i = 0; i < maxAttempts; i++) {
			isFilled = await checkIfOrderFilled(
				order.id as HexString,
				polygonAmoyPublicClient,
				chainConfigService.getIntentGatewayV2Address(polygonAmoyId),
			)
			if (isFilled) {
				console.log("Order filled on Polygon Amoy!")
				break
			}
			await new Promise((resolve) => setTimeout(resolve, 5000))
		}

		expect(isFilled).toBe(true)

		// Cleanup
		intentFiller.stop()
		await intentsCoprocessor.disconnect()
	}, 600_000)

	// cast send 0x0000000071727De22E5E9d8BAf0edAc6f37da032 "depositTo(address)" 0xEa4f68301aCec0dc9Bbe10F15730c59FB79d237E --value 0.1ether --rpc-url  --private-key

	// 10 minutes timeout

	it.skip("Should test commitment generation", async () => {
		// {"user":"0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e","source":"0x45564d2d3937","destination":"0x45564d2d3830303032","deadline":"12545151568145","nonce":"0","fees":"1000000000000000000","session":"0x93756a66e6499c25ada401461cb17faef6b122fd","predispatch":{"assets":[],"call":"0x"},"inputs":[{"token":"0x000000000000000000000000c625ec7d30a4b1aaefb1304610cdacd0d606ac92","amount":"1000000000000000000"}],"output":{"beneficiary":"0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e","assets":[{"token":"0x000000000000000000000000693b854d6965ffeaae21c74049dea644b56fcacb","amount":"60000000000000000"}],"call":"0x"}}
		const order: OrderV2 = {
			user: "0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e",
			source: "0x45564d2d3937",
			destination: "0x45564d2d3830303032",
			deadline: 12545151568145n,
			nonce: 82n,
			fees: 1000000000000000000n,
			session: "0x93756a66e6499c25ada401461cb17faef6b122fd",
			predispatch: { assets: [], call: "0x" },
			inputs: [
				{
					token: "0x000000000000000000000000c625ec7d30a4b1aaefb1304610cdacd0d606ac92",
					amount: 1000000000000000000n,
				},
			],
			output: {
				beneficiary: "0x000000000000000000000000ea4f68301acec0dc9bbe10f15730c59fb79d237e",
				assets: [
					{
						token: "0x000000000000000000000000693b854d6965ffeaae21c74049dea644b56fcacb",
						amount: 60000000000000000n,
					},
				],
				call: "0x",
			},
		}
		const commitment = orderV2Commitment(order)
		console.log("Commitment:", commitment)
	})
})

// ============================================================================
// Setup and Helper Functions
// ============================================================================

async function setUp() {
	const bscChapelId = "EVM-97"
	const polygonAmoyId = "EVM-80002"

	const chains = [bscChapelId, polygonAmoyId]

	// Create chain configurations
	const testChainConfigs: UserProvidedChainConfig[] = [
		{
			chainId: 97, // BSC Chapel (source chain)
			rpcUrl: process.env.BSC_CHAPEL || "https://bnb-testnet.api.onfinality.io/public",
		},
		{
			chainId: 80002, // Polygon Amoy (destination chain)
			rpcUrl: process.env.POLYGON_AMOY || "",
		},
	]

	// Filler service config with Hyperbridge support for solver selection
	const fillerConfigForService: FillerServiceConfig = {
		privateKey: process.env.PRIVATE_KEY as HexString,
		maxConcurrentOrders: 5,
		// Hyperbridge configuration for solver support
		hyperbridgeWsUrl: process.env.HYPERBRIDGE_GARGANTUA,
		substratePrivateKey: process.env.SECRET_PHRASE, // Substrate mnemonic
		solverAccountContractAddress: "0xd42EFC09607dA5577dfB7Ecc3E0756b0f45902E3",
	}

	const chainConfigService = new FillerConfigService(testChainConfigs, fillerConfigForService)
	const chainConfigs: ChainConfig[] = chains.map((chain) => chainConfigService.getChainConfig(chain))

	// Create confirmation policy
	const confirmationPolicyConfig = {
		"97": {
			minAmount: "1",
			maxAmount: "1000",
			minConfirmations: 1,
			maxConfirmations: 5,
		},
		"80002": {
			minAmount: "1",
			maxAmount: "1000",
			minConfirmations: 1,
			maxConfirmations: 5,
		},
	}

	const confirmationPolicy = new ConfirmationPolicy(confirmationPolicyConfig)

	const fillerConfig: FillerConfig = {
		confirmationPolicy: {
			getConfirmationBlocks: (chainId: number, amountUsd: number) =>
				confirmationPolicy.getConfirmationBlocks(chainId, new Decimal(amountUsd)),
		},
		maxConcurrentOrders: 5,
		pendingQueueConfig: {
			maxRechecks: 10,
			recheckDelayMs: 30000,
		},
	}

	// Create shared services
	const privateKey = process.env.PRIVATE_KEY as HexString
	const sharedCacheService = new CacheService()
	const chainClientManager = new ChainClientManager(chainConfigService, privateKey)
	const contractService = new ContractInteractionService(
		chainClientManager,
		privateKey,
		chainConfigService,
		sharedCacheService,
	)

	// Get clients
	const bscWalletClient = chainClientManager.getWalletClient(bscChapelId)
	const polygonAmoyWalletClient = chainClientManager.getWalletClient(polygonAmoyId)
	const bscPublicClient = chainClientManager.getPublicClient(bscChapelId)
	const polygonAmoyPublicClient = chainClientManager.getPublicClient(polygonAmoyId)

	// Get contract addresses
	const bscIntentGatewayV2Address = chainConfigService.getIntentGatewayV2Address(bscChapelId)
	const polygonAmoyIntentGatewayV2Address = chainConfigService.getIntentGatewayV2Address(polygonAmoyId)
	const bscIsmpHostAddress = chainConfigService.getHostAddress(bscChapelId)
	const polygonAmoyIsmpHostAddress = chainConfigService.getHostAddress(polygonAmoyId)

	// Create contract instances
	const bscIntentGatewayV2 = getContract({
		address: bscIntentGatewayV2Address,
		abi: INTENT_GATEWAY_V2_ABI,
		client: { public: bscPublicClient, wallet: bscWalletClient },
	})

	const polygonAmoyIntentGatewayV2 = getContract({
		address: polygonAmoyIntentGatewayV2Address,
		abi: INTENT_GATEWAY_V2_ABI,
		client: { public: polygonAmoyPublicClient, wallet: polygonAmoyWalletClient },
	})

	// Create SDK helper for preparing orders (source -> destination)
	const bscEvmChain = new EvmChain({
		chainId: 97,
		host: bscIsmpHostAddress,
		rpcUrl: chainConfigService.getRpcUrl(bscChapelId),
	})

	const polygonAmoyEvmChain = new EvmChain({
		chainId: 80002,
		host: polygonAmoyIsmpHostAddress,
		rpcUrl: chainConfigService.getRpcUrl(polygonAmoyId),
	})

	// IntentGatewayV2 helper: source (BSC Chapel) -> dest (Polygon Amoy)
	const intentGatewayHelper = new IntentGatewayV2(bscEvmChain, polygonAmoyEvmChain)

	const bscIsmpHost = getContract({
		address: bscIsmpHostAddress,
		abi: EVM_HOST,
		client: { public: bscPublicClient, wallet: bscWalletClient },
	})

	const polygonAmoyIsmpHost = getContract({
		address: polygonAmoyIsmpHostAddress,
		abi: EVM_HOST,
		client: { public: polygonAmoyPublicClient, wallet: polygonAmoyWalletClient },
	})

	return {
		chainClientManager,
		bscWalletClient,
		polygonAmoyWalletClient,
		bscPublicClient,
		polygonAmoyPublicClient,
		bscIntentGatewayV2,
		polygonAmoyIntentGatewayV2,
		bscIsmpHostAddress,
		polygonAmoyIsmpHostAddress,
		bscIsmpHost,
		polygonAmoyIsmpHost,
		contractService,
		bscChapelId,
		polygonAmoyId,
		chainConfigService,
		fillerConfig,
		chainConfigs,
		intentGatewayHelper,
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

	if (approval === 0n) {
		console.log(`Approving token ${tokenAddress} for ${spender}`)
		const tx = await walletClient.writeContract({
			abi: ERC20_ABI,
			address: tokenAddress,
			functionName: "approve",
			args: [spender, maxUint256],
			chain: walletClient.chain,
			account: walletClient.account!,
		})

		console.log("Approval tx:", tx)
		await publicClient.waitForTransactionReceipt({ hash: tx, confirmations: 1 })
		console.log("Token approved")
	}
}

async function checkIfOrderFilled(
	commitment: HexString,
	client: PublicClient,
	intentGatewayV2Address: HexString,
): Promise<boolean> {
	try {
		// The filled mapping is at storage slot 6 in IntentGatewayV2 contract
		const mappingSlot = 6n

		const slot = keccak256(encodePacked(["bytes32", "uint256"], [commitment, mappingSlot]))

		const filledStatus = await client.getStorageAt({
			address: intentGatewayV2Address,
			slot: slot,
		})

		console.log("Filled status:", filledStatus)
		return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
	} catch (error) {
		console.error("Error checking if order filled:", error)
		return false
	}
}
