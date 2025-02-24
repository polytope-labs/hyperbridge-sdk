/**
 * Sleeps for the specified number of milliseconds.
 * @param ms The number of milliseconds to sleep.
 */
export function sleep(ms?: number) {
	return new Promise((resolve) => setTimeout(resolve, ms || 5_000))
}

export function isEvmChain(stateMachineId: string): boolean {
	return stateMachineId.startsWith("EVM")
}
