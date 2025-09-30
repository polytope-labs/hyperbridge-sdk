import fetch from "node-fetch"

const GRAPHQL_ENDPOINT = "http://localhost:3100/graphql"

describe("Incentives GraphQL Test", () => {
	it("should fetch a list of HyperbridgeRelayerReward entities", async () => {
		const query = `
          query {
             hyperbridgeRelayerRewards(first: 5, orderBy: TOTAL_REWARD_AMOUNT_DESC) {
                nodes {
                   id
                   totalRewardAmount
                   totalConsensusRewardAmount
                   totalMessagingRewardAmount
                   reputationAssetBalance
                }
             }
          }
       `

		const response = await fetch(GRAPHQL_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query }),
		})

		const json = await response.json() as any

		expect(response.ok).toBe(true)
		expect(json.errors).toBeUndefined()
		expect(json.data.hyperbridgeRelayerRewards).toBeDefined()
		expect(Array.isArray(json.data.hyperbridgeRelayerRewards.nodes)).toBe(true)

		if (json.data.hyperbridgeRelayerRewards.nodes.length > 0) {
			console.log(`Successfully fetched ${json.data.hyperbridgeRelayerRewards.nodes.length} relayer rewards.`)
			const firstReward = json.data.hyperbridgeRelayerRewards.nodes[0]
			expect(firstReward.id).toBeDefined()
			expect(firstReward.totalRewardAmount).toBeDefined()
		} else {
			console.log("Test passed, but no HyperbridgeRelayerReward entities were found.")
		}
	}, 30000)
})