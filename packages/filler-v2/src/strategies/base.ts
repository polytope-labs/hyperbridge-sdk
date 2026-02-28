import { OrderV2, ExecutionResult, IntentsCoprocessor } from "@hyperbridge/sdk"

/** Supported token types for same-token execution */
export type SupportedTokenType = "USDT" | "USDC"

export interface FillerStrategy {
	name: string

	canFill(order: OrderV2): Promise<boolean>

	calculateProfitability(order: OrderV2): Promise<number>

	executeOrder(order: OrderV2, hyperbridge?: IntentsCoprocessor): Promise<ExecutionResult>
}
