import { describe, it, expect } from "vitest"
import type { HexString } from "@hyperbridge/sdk"
import { ChainClientManager, FillerConfigService, type UserProvidedChainConfig } from "@/services"
import { BinanceRebalancer, type UnifiedRebalanceOptions } from "@/services/rebalancers"
import "../setup"

describe.sequential("BinanceRebalancer - CEX integration", () => {
	const apiKey = process.env.BINANCE_API_KEY
	const apiSecret = process.env.BINANCE_API_SECRET
	const privateKey = process.env.PRIVATE_KEY as HexString

	if (!apiKey || !apiSecret) {
		throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET env vars are required for this test")
	}

	const chainConfigs: UserProvidedChainConfig[] = [
		{
			chainId: 56, // BSC mainnet
			rpcUrl: process.env.BSC_MAINNET!,
		},
		{
			chainId: 42161, // Arbitrum mainnet
			rpcUrl: process.env.ARBITRUM_MAINNET!,
		},
	]

	const configService = new FillerConfigService(chainConfigs)
	const chainClientManager = new ChainClientManager(configService, privateKey)

	// Travel rule questionnaire for self-transfer to own unhosted wallet (e.g. UAE)
	// See Binance docs: https://developers.binance.com/docs/wallet/travel-rule/withdraw-questionnaire#uae
	const travelRuleQuestionnaire = {
		isAddressOwner: 1,
		sendTo: 1,
	}

	const rebalancer = new BinanceRebalancer(chainClientManager, configService, privateKey, {
		apiKey,
		apiSecret,
		travelRuleQuestionnaire,
	})

	it("should fetch Binance coin/network configuration for USDT between BSC and Arbitrum", async () => {
		const options: UnifiedRebalanceOptions = {
			coin: "USDT",
			source: "EVM-56", // BSC
			destination: "EVM-42161", // Arbitrum
			amount: "100",
		}

		const estimate = await rebalancer.estimateCexRebalance(options)

		console.log("Binance CEX estimate:", estimate)

		expect(estimate.withdrawalFee).toBeDefined()
		expect(estimate.minWithdrawal).toBeDefined()
		expect(estimate.withdrawEnabled).toBeTypeOf("boolean")
		expect(estimate.depositEnabled).toBeTypeOf("boolean")
	}, 60_000)

	it("should wait for an existing Binance deposit to be credited", async () => {
		const txHash = "0x6d152d2b0f80e89901fab191ffbbb9ab1b6da1c28d84f97157d063a18cb29d60"

		// Adjust coin if this tx is for a different asset
		await rebalancer.waitForDepositCredit("USDT", txHash)

		console.log("Binance deposit confirmed for tx:", txHash)
	}, 300_000)

	it.only("should send 10 USDT from BSC to Arbitrum via Binance CEX with travel rule", async () => {
		const result = await rebalancer.sendViaCex({
			amount: "10",
			coin: "USDT",
			source: "EVM-56", // BSC mainnet
			destination: "EVM-42161", // Arbitrum mainnet
		})

		console.log("Binance CEX rebalance result (travel rule):", result)

		expect(result.success).toBe(true)
		expect(result.amountDeposited).toBe("10")
		expect(Number(result.amountReceived)).toBeGreaterThan(0)
	}, 3_600_000)
})
