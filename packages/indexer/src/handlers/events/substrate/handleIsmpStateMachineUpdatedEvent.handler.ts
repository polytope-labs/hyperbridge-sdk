import { SubstrateEvent } from "@subql/types"
import { StateMachineService } from "@/services/stateMachine.service"
import {
	extractStateMachineIdFromSubstrateEventData,
	getHostStateMachine,
	StateMachineError,
	SubstrateEventValidator,
} from "@/utils/substrate.helpers"

/**
 * Handles ISMP (Interoperable-State Machine Protocol) StateMachineUpdated events from Substrate chains.
 * This function processes state machine update events, validates them, and creates a record
 * in the database using the StateMachineService.
 *
 * The function performs the following:
 * 1. Extracts the state machine ID from the event data
 * 2. Gets the host state machine information
 * 3. Validates chain metadata and event data
 * 4. Processes the event based on its method type
 * 5. Stores the state machine update in the database
 *
 * @param event - The SubstrateEvent object containing event data, block information, and extrinsic details
 * @returns Promise<void> - Completes when the event has been successfully processed and stored
 * @throws StateMachineError - When validation fails or an unsupported method is encountered
 */
export async function handleIsmpStateMachineUpdatedEvent(event: SubstrateEvent): Promise<void> {
	const stateMachineId = extractStateMachineIdFromSubstrateEventData(event.event.data.toString())

	const host = getHostStateMachine(chainId)

	if (typeof stateMachineId === "undefined") return

	try {
		if (!SubstrateEventValidator.validateChainMetadata(host, stateMachineId)) {
			throw new StateMachineError("Invalid chain metadata", host, event.block.block.header.number.toNumber())
		}

		if (!SubstrateEventValidator.validateStateMachineEvent(event)) {
			logger.error(`Invalid state machine event data: ${JSON.stringify(event.event)}`)
			throw new StateMachineError(
				"Invalid state machine event data",
				host,
				event.block.block.header.number.toNumber(),
			)
		}

		logger.info(
			`Handling ISMP StateMachineUpdatedEvent. Block Number: ${event.block.block.header.number.toNumber()}`,
		)

		const { method, data } = event.event

		const timestamp = Math.floor(event.block.timestamp!.getTime() / 1000)
		const height = Number(data[1].toString())
		const blockNumber = event.block.block.header.number.toNumber()
		const blockHash = event.block.block.header.hash.toString()
		const transactionHash = event.extrinsic?.extrinsic?.hash?.toString() || ""
		const transactionIndex = event.extrinsic?.idx || 0

		if (isNaN(height)) {
			logger.error(`Invalid height value in event data: ${data[1].toString()}`)
			return
		}

		switch (method) {
			case "StateMachineUpdated":
				await StateMachineService.createSubstrateStateMachineUpdatedEvent(
					{
						blockHash,
						blockNumber,
						transactionHash,
						transactionIndex,
						timestamp,
						stateMachineId,
						height,
					},
					host,
				)
				break

			default:
				throw new StateMachineError(
					`Unsupported method: ${method}`,
					host,
					event.block.block.header.number.toNumber(),
				)
		}
	} catch (error) {
		logger.error("State machine event processing failed", {
			error: error instanceof Error ? error.message : "Unknown error",
			host,
			blockNumber: event.block.block.header.number.toNumber(),
			method: event.event.method,
		})

		// Re-throw to maintain indexer state
		throw error
	}
}
