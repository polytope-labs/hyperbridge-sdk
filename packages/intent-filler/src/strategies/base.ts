import { Order, FillerConfig, ExecutionResult } from "@/types"
import { PublicClient } from "viem"
export interface FillerStrategy {
	name: string

	canFill(order: Order, config: FillerConfig): Promise<boolean>

	calculateProfitability(order: Order): Promise<number>

	executeOrder(order: Order): Promise<ExecutionResult>
}
