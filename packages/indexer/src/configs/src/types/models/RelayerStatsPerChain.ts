// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';



export type RelayerStatsPerChainProps = Omit<RelayerStatsPerChain, NonNullable<FunctionPropertyNames<RelayerStatsPerChain>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatRelayerStatsPerChainProps = Omit<RelayerStatsPerChainProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class RelayerStatsPerChain implements CompatEntity {

    constructor(
        
        id: string,
        relayerId: string,
        chain: string,
        numberOfSuccessfulMessagesDelivered: bigint,
        numberOfFailedMessagesDelivered: bigint,
        gasUsedForSuccessfulMessages: bigint,
        gasUsedForFailedMessages: bigint,
        gasFeeForSuccessfulMessages: bigint,
        gasFeeForFailedMessages: bigint,
        usdGasFeeForSuccessfulMessages: bigint,
        usdGasFeeForFailedMessages: bigint,
        feesEarned: bigint,
    ) {
        this.id = id;
        this.relayerId = relayerId;
        this.chain = chain;
        this.numberOfSuccessfulMessagesDelivered = numberOfSuccessfulMessagesDelivered;
        this.numberOfFailedMessagesDelivered = numberOfFailedMessagesDelivered;
        this.gasUsedForSuccessfulMessages = gasUsedForSuccessfulMessages;
        this.gasUsedForFailedMessages = gasUsedForFailedMessages;
        this.gasFeeForSuccessfulMessages = gasFeeForSuccessfulMessages;
        this.gasFeeForFailedMessages = gasFeeForFailedMessages;
        this.usdGasFeeForSuccessfulMessages = usdGasFeeForSuccessfulMessages;
        this.usdGasFeeForFailedMessages = usdGasFeeForFailedMessages;
        this.feesEarned = feesEarned;
        
    }

    public id: string;
    public relayerId: string;
    public chain: string;
    public numberOfSuccessfulMessagesDelivered: bigint;
    public numberOfFailedMessagesDelivered: bigint;
    public gasUsedForSuccessfulMessages: bigint;
    public gasUsedForFailedMessages: bigint;
    public gasFeeForSuccessfulMessages: bigint;
    public gasFeeForFailedMessages: bigint;
    public usdGasFeeForSuccessfulMessages: bigint;
    public usdGasFeeForFailedMessages: bigint;
    public feesEarned: bigint;
    

    get _name(): string {
        return 'RelayerStatsPerChain';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save RelayerStatsPerChain entity without an ID");
        await store.set('RelayerStatsPerChain', id.toString(), this as unknown as CompatRelayerStatsPerChainProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove RelayerStatsPerChain entity without an ID");
        await store.remove('RelayerStatsPerChain', id.toString());
    }

    static async get(id: string): Promise<RelayerStatsPerChain | undefined> {
        assert((id !== null && id !== undefined), "Cannot get RelayerStatsPerChain entity without an ID");
        const record = await store.get('RelayerStatsPerChain', id.toString());
        if (record) {
            return this.create(record as unknown as RelayerStatsPerChainProps);
        } else {
            return;
        }
    }

    static async getByRelayerId(relayerId: string, options: GetOptions<CompatRelayerStatsPerChainProps>): Promise<RelayerStatsPerChain[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRelayerStatsPerChainProps>('RelayerStatsPerChain', 'relayerId', relayerId, options);
        return records.map(record => this.create(record as unknown as RelayerStatsPerChainProps));
    }
    

    static async getByChain(chain: string, options: GetOptions<CompatRelayerStatsPerChainProps>): Promise<RelayerStatsPerChain[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRelayerStatsPerChainProps>('RelayerStatsPerChain', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as RelayerStatsPerChainProps));
    }
    

    static async getByFeesEarned(feesEarned: bigint, options: GetOptions<CompatRelayerStatsPerChainProps>): Promise<RelayerStatsPerChain[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRelayerStatsPerChainProps>('RelayerStatsPerChain', 'feesEarned', feesEarned, options);
        return records.map(record => this.create(record as unknown as RelayerStatsPerChainProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<RelayerStatsPerChainProps>[], options: GetOptions<RelayerStatsPerChainProps>): Promise<RelayerStatsPerChain[]> {
        const records = await store.getByFields<CompatRelayerStatsPerChainProps>('RelayerStatsPerChain', filter  as unknown as FieldsExpression<CompatRelayerStatsPerChainProps>[], options as unknown as GetOptions<CompatRelayerStatsPerChainProps>);
        return records.map(record => this.create(record as unknown as RelayerStatsPerChainProps));
    }

    static create(record: RelayerStatsPerChainProps): RelayerStatsPerChain {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.relayerId,
            record.chain,
            record.numberOfSuccessfulMessagesDelivered,
            record.numberOfFailedMessagesDelivered,
            record.gasUsedForSuccessfulMessages,
            record.gasUsedForFailedMessages,
            record.gasFeeForSuccessfulMessages,
            record.gasFeeForFailedMessages,
            record.usdGasFeeForSuccessfulMessages,
            record.usdGasFeeForFailedMessages,
            record.feesEarned,
        );
        Object.assign(entity,record);
        return entity;
    }
}
