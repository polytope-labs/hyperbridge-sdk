// Returns true if candidate <= reference * (1 + thresholdBps/10000)
export function isWithinThreshold(candidate: bigint, reference: bigint, thresholdBps: bigint): boolean {
	const basisPoints = 10000n
	return candidate * basisPoints <= reference * (basisPoints + thresholdBps)
}
