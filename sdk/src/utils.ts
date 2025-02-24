/**
 * Sleeps for the specified number of milliseconds.
 * @param ms The number of milliseconds to sleep.
 */
export function sleep(ms?: number) {
	return new Promise((resolve) => setTimeout(resolve, ms || 5_000))
}

/**
 * Checks if the given state machine ID represents an EVM chain.
 * @param stateMachineId The state machine ID to check.
 */
export function isEvmChain(stateMachineId: string): boolean {
	return stateMachineId.startsWith("EVM")
}

/**
 * Checks if the given state machine ID represents a Substrate chain.
 * @param stateMachineId The state machine ID to check.
 */
export function isSubstrateChain(stateMachineId: string): boolean {
	return (
		stateMachineId.startsWith("POLKADOT") ||
		stateMachineId.startsWith("KUSAMA") ||
		stateMachineId.startsWith("SUBSTRATE")
	)
}
