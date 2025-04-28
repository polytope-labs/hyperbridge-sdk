export class ConfirmationPolicy {
	// Maps chainId -> amount threshold -> confirmation blocks
	private policies: Map<number, Map<bigint, number>>

	constructor(policyConfig: Record<string, Record<string, number>>) {
		this.policies = new Map()

		// Convert the config to maps for efficient lookup
		Object.entries(policyConfig).forEach(([chainId, thresholds]) => {
			const thresholdMap = new Map()

			Object.entries(thresholds).forEach(([amount, blocks]) => {
				thresholdMap.set(BigInt(amount), blocks)
			})

			this.policies.set(Number(chainId), thresholdMap)
		})
	}

	getConfirmationBlocks(chainId: number, amount: bigint): number {
		const chainPolicy = this.policies.get(chainId)
		if (!chainPolicy) return this.getDefaultConfirmations(chainId)

		// Find the highest threshold that is less than or equal to the amount
		let confirmations = 1 // Default

		for (const [threshold, blocks] of chainPolicy.entries()) {
			if (amount <= threshold && blocks > confirmations) {
				confirmations = blocks
			}
		}

		return confirmations
	}

	private getDefaultConfirmations(chainId: number): number {
		// Default confirmation blocks based on chain
		const defaults: Record<number, number> = {
			97: 1, // BSC Testnet
			10200: 1, // Gnosis Chiado
		}

		return defaults[chainId] || 1
	}
}
