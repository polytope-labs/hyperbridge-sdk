import { TOKEN_GATEWAY_CONTRACT_ADDRESSES } from "@/addresses/tokenGateway.addresses"
import PriceHelper from "../price.helpers"

describe("PriceHelper.getTokenPriceInUSDCoingecko", () => {
	const ETH_MAINNET_ADDRESS = TOKEN_GATEWAY_CONTRACT_ADDRESSES["EVM-1"]
	const SONEIUM_MAINNET_ADDRESS = TOKEN_GATEWAY_CONTRACT_ADDRESSES["EVM-1868"]
	const UNKNOWN_ADDRESS = "0x9999999999999999999999999999999999999999"

	it("should return correct price and amount value for valid token", async () => {
		const result = await PriceHelper.getTokenPriceInUSDCoingecko(
			ETH_MAINNET_ADDRESS,
			BigInt("1000000000000000000"),
			18,
		)

		expect(result).toHaveProperty("priceInUSD")
		expect(result).toHaveProperty("amountValueInUSD")
		expect(parseFloat(result.priceInUSD)).toBeGreaterThan(1000)
		expect(parseFloat(result.amountValueInUSD)).toBeGreaterThan(1000)
	})

	it("should return correct price and amount value for sonenium contract address", async () => {
		const result = await PriceHelper.getTokenPriceInUSDCoingecko(
			SONEIUM_MAINNET_ADDRESS,
			BigInt("1000000000000000000"),
			18,
		)

		expect(result).toEqual({
			priceInUSD: "1.005000000000000000",
			amountValueInUSD: "1.005000000000000000",
		})
	})

	it("should return zero values when token address is not found", async () => {
		const result = await PriceHelper.getTokenPriceInUSDCoingecko(UNKNOWN_ADDRESS, BigInt("1000000000000000000"), 18)

		expect(result).toEqual({
			priceInUSD: "0",
			amountValueInUSD: "0",
		})
	})
})
