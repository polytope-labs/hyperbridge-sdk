import { Order, FillerConfig, ExecutionResult } from "@/types"
import { ethers } from "ethers"
export interface FillerStrategy {
	name: string

	canFill(
		order: Order,
		config: FillerConfig,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<boolean>

	calculateProfitability(
		order: Order,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<number>

	executeOrder(
		order: Order,
		providers: { sourceProvider: ethers.providers.Provider; destProvider: ethers.providers.Provider },
	): Promise<ExecutionResult>
}
