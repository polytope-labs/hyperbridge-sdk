export * from "./chains/evm"

/**
 * Interface representing a chain.
 */
export interface IChain {
	/*
	 * Returns the current timestamp of the chain.
	 */
	timestamp(): Promise<bigint>
}
