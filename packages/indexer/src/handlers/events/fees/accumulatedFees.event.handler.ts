import { SubstrateEvent } from "@subql/types";
import { AccumulatedFee } from "@/configs/src/types";
import { DailyTreasuryRewardService } from "@/services/dailyTreasuryReward.service";
import { encodeAddress } from "@polkadot/util-crypto";

export async function handleAccumulateFeesEvent(event: SubstrateEvent): Promise<void> {
	try {
		const { event: { data }, block } = event;

		const [relayerBytes, stateMachine, rawAmountCodec] = data;

		const relayerAddress = encodeAddress(relayerBytes.toHex());
		const rawAmount = (rawAmountCodec as any).toBigInt();

		const statemachineId = stateMachine.toJSON();
		const recordId = `${relayerAddress}-${statemachineId}`;
		const timestamp = new Date(block.timestamp!);

		let record = await AccumulatedFee.get(recordId);
		if (!record) {
			record = AccumulatedFee.create({
				id: recordId,
				relayer: relayerAddress,
				chainId: statemachineId,
				totalFees: BigInt(0),
				lastUpdatedAt: timestamp,
			});
		}

		const decimals = await DailyTreasuryRewardService.getFeeTokenDecimals(statemachineId);
		const normalizedAmount = rawAmount * (10n ** (18n - BigInt(decimals)));


		record.totalFees += normalizedAmount;
		record.lastUpdatedAt = timestamp;

		await record.save();

		logger.info(`Updated accumulated fees for relayer ${relayerAddress} on chain ${chainId}`);
	} catch(e) {
		const errorMessage = e instanceof Error ? e.message : String(e)
		logger.error(`Failed to update accumulated fees: ${errorMessage}`)
	}
}