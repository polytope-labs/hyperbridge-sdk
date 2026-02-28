import { encodeFunctionData, encodeAbiParameters } from "viem"
import { toHex } from "viem"
import type { OrderV2 } from "@/types"
import type { ERC7821Call } from "@/types"
import type { HexString } from "@/types"
import ERC7821ABI from "@/abis/erc7281"
import { ERC7821_BATCH_MODE } from "./types"
import { requestCommitmentKey } from "@/chain"
import type { IEvmChain } from "@/chain"
import type { IProof } from "@/chain"

/**
 * Standalone utility to encode calls into ERC-7821 execute function calldata.
 * Can be used outside of the IntentGatewayV2 class (e.g., by filler strategies
 * that need to build custom batch calldata for swap+fill operations).
 */
export function encodeERC7821ExecuteBatch(calls: ERC7821Call[]): HexString {
	const executionData = encodeAbiParameters(
		[{ type: "tuple[]", components: ERC7821ABI.ABI[1].components }],
		[calls.map((call) => ({ target: call.target, value: call.value, data: call.data }))],
	) as HexString

	return encodeFunctionData({
		abi: ERC7821ABI.ABI,
		functionName: "execute",
		args: [ERC7821_BATCH_MODE, executionData],
	}) as HexString
}

/**
 * Fetches proof for the source chain.
 *
 * @internal
 */
export async function fetchSourceProof(
	commitment: HexString,
	source: IEvmChain,
	sourceStateMachine: string,
	sourceConsensusStateId: string,
	sourceHeight: bigint,
): Promise<IProof> {
	const { slot1, slot2 } = requestCommitmentKey(commitment)
	const proofHex = await source.queryStateProof(sourceHeight, [slot1, slot2])

	return {
		height: sourceHeight,
		stateMachine: sourceStateMachine,
		consensusStateId: sourceConsensusStateId,
		proof: proofHex,
	}
}

/**
 * Transforms an OrderV2 (SDK type) to the Order struct expected by the contract.
 */
export function transformOrderForContract(order: OrderV2): Omit<OrderV2, "id" | "transactionHash"> {
	const { id: _id, transactionHash: _txHash, ...contractOrder } = order
	return {
		...contractOrder,
		source: order.source.startsWith("0x") ? order.source : toHex(order.source),
		destination: order.destination.startsWith("0x") ? order.destination : toHex(order.destination),
	}
}
