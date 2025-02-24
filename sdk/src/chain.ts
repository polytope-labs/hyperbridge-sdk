export * from "./chains/evm"

export interface IChain {
	timestamp(): Promise<bigint>
}
