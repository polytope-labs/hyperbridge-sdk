import { Order, FillerConfig, ExecutionResult } from "@/types"

export interface FillerStrategy {
	name: string

	canFill(order: Order, config: FillerConfig): Promise<boolean>

	calculateProfitability(order: Order): Promise<number>

	executeOrder(order: Order): Promise<ExecutionResult>
}
