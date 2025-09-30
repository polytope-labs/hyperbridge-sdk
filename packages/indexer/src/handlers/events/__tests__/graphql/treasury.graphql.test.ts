import fetch from "node-fetch"

const TREASURY_ADDRESS = "13UVJyLkyUpEiXBx5p776dHQoBuuk3Y5PYp5Aa89rYWePWA3"
const GRAPHQL_ENDPOINT = "http://localhost:3100/graphql"

describe("Incentives GraphQL Test", () => {
	it("should fetch the single Treasury entity", async () => {
		const query = `
           query {
              treasury(id: "${TREASURY_ADDRESS}") {
                 id
                 totalAmountTransferredIn
                 totalAmountTransferredOut
                 totalBalance
                 lastUpdatedAt
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
		expect(json.data).toBeDefined()

		if (json.data.treasury) {
			console.log("Successfully fetched the Treasury entity.")
			expect(json.data.treasury.id).toEqual(TREASURY_ADDRESS)
			expect(json.data.treasury.totalBalance).toBeDefined()
		} else {
			console.warn("Test passed, but the Treasury entity has not been created yet.")
		}
	}, 30000)
})