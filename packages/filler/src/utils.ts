import { ADDRESS_ZERO } from "hyperbridge-sdk"

export async function fetchTokenUsdPriceOnchain(address: string, decimals: number): Promise<bigint> {
	if (address == ADDRESS_ZERO) {
		return BigInt(10 ** 18)
	}

	try {
		const response = await fetch(
			`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${address}&vs_currencies=usd`,
		)
		const data = await response.json()

		if (!data[address.toLowerCase()]?.usd) {
			throw new Error(`Price not found for token address: ${address}`)
		}

		return BigInt(Math.floor(data[address.toLowerCase()].usd * 10 ** decimals))
	} catch (error) {
		console.error("Error fetching token price:", error)
		throw error
	}
}

export async function get1inchExactOutputQuote(params: {
	chainId: number
	srcToken: string
	dstToken: string
	amount: string
	fromAddress: string
	slippage: number
	isExactOut: boolean
}) {
	const API_URL = `https://api.1inch.io/v5.0/${params.chainId}/swap`

	const queryParams = new URLSearchParams({
		fromTokenAddress: params.srcToken,
		toTokenAddress: params.dstToken,
		fromAddress: params.fromAddress,
		slippage: params.slippage.toString(),
		disableEstimate: "true",
		protocols: "DEXES",
	})

	// Handle exact output case
	if (params.isExactOut) {
		queryParams.set("destAmount", params.amount)
	} else {
		queryParams.set("amount", params.amount)
	}

	const response = await fetch(`${API_URL}?${queryParams}`)
	if (!response.ok) {
		throw new Error(`1inch API error: ${await response.text()}`)
	}
	return await response.json()
}
