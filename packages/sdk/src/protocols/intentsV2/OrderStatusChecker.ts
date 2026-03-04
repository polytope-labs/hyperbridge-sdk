import { isHex, hexToString, parseAbiItem } from "viem"
import { ABI as IntentGatewayV2ABI } from "@/abis/IntentGatewayV2"
import { orderV2Commitment } from "@/utils"
import type { OrderV2, HexString } from "@/types"
import type { IntentsV2Context } from "./types"

export class OrderStatusChecker {
	constructor(private readonly ctx: IntentsV2Context) {}

	/**
	 * Checks if a V2 order has been filled by reading the commitment storage slot on the destination chain.
	 *
	 * Reads the storage slot returned by `calculateCommitmentSlotHash` on the IntentGatewayV2 contract.
	 * A non-zero value at that slot means the solver has called `fillOrder` and the order is complete
	 * from the user's perspective (the beneficiary has received their tokens).
	 *
	 * @param order - The V2 order to check. `order.id` is used as the commitment; if not set it is computed.
	 * @returns True if the order has been filled on the destination chain, false otherwise.
	 */
	async isOrderFilled(order: OrderV2): Promise<boolean> {
		const commitment = (order.id ?? orderV2Commitment(order)) as HexString
		const destStateMachineId = isHex(order.destination)
			? hexToString(order.destination as HexString)
			: order.destination

		const intentGatewayV2Address = this.ctx.dest.configService.getIntentGatewayV2Address(destStateMachineId)

		const filledSlot = await this.ctx.dest.client.readContract({
			abi: IntentGatewayV2ABI,
			address: intentGatewayV2Address,
			functionName: "calculateCommitmentSlotHash",
			args: [commitment],
		})

		const filledStatus = await this.ctx.dest.client.getStorageAt({
			address: intentGatewayV2Address,
			slot: filledSlot as HexString,
		})

		return filledStatus !== "0x0000000000000000000000000000000000000000000000000000000000000000"
	}

	/**
	 * Checks if a V2 order has been refunded by querying the `EscrowRefunded` event on the source chain.
	 *
	 * Unlike V1 (which reads storage slots for escrowed token amounts), V2 does not expose a storage
	 * slot calculation function for the escrow state. Instead, refunds are signalled by the
	 * `EscrowRefunded(bytes32 indexed commitment)` event emitted on the source chain after a
	 * successful cancellation is relayed back from Hyperbridge.
	 *
	 * If `order.transactionHash` is set, the log search starts from that block to avoid
	 * scanning the entire chain history.
	 *
	 * @param order - The V2 order to check. `order.id` is used as the commitment; if not set it is computed.
	 * @returns True if the escrow has been refunded to the user on the source chain, false otherwise.
	 */
	async isOrderRefunded(order: OrderV2): Promise<boolean> {
		const commitment = (order.id ?? orderV2Commitment(order)) as HexString
		const sourceStateMachineId = isHex(order.source)
			? hexToString(order.source as HexString)
			: order.source

		const intentGatewayV2Address = this.ctx.source.configService.getIntentGatewayV2Address(sourceStateMachineId)

		let fromBlock: bigint | undefined
		if (order.transactionHash) {
			const receipt = await this.ctx.source.client.getTransactionReceipt({ hash: order.transactionHash })
			fromBlock = receipt.blockNumber
		}

		const logs = await this.ctx.source.client.getLogs({
			address: intentGatewayV2Address,
			event: parseAbiItem("event EscrowRefunded(bytes32 indexed commitment)"),
			args: { commitment },
			fromBlock,
			toBlock: "latest",
		})

		return logs.length > 0
	}
}
