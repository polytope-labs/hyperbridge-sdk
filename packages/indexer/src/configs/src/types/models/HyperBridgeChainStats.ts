// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';



export type HyperBridgeChainStatsProps = Omit<HyperBridgeChainStats, NonNullable<FunctionPropertyNames<HyperBridgeChainStats>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatHyperBridgeChainStatsProps = Omit<HyperBridgeChainStatsProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class HyperBridgeChainStats implements CompatEntity {

    constructor(
        
        id: string,
        numberOfMessagesSent: bigint,
        numberOfDeliveredMessages: bigint,
        numberOfFailedDeliveries: bigint,
        numberOfTimedOutMessages: bigint,
        totalTransfersIn: bigint,
        protocolFeesEarned: bigint,
        feesPayedOutToRelayers: bigint,
    ) {
        this.id = id;
        this.numberOfMessagesSent = numberOfMessagesSent;
        this.numberOfDeliveredMessages = numberOfDeliveredMessages;
        this.numberOfFailedDeliveries = numberOfFailedDeliveries;
        this.numberOfTimedOutMessages = numberOfTimedOutMessages;
        this.totalTransfersIn = totalTransfersIn;
        this.protocolFeesEarned = protocolFeesEarned;
        this.feesPayedOutToRelayers = feesPayedOutToRelayers;
        
    }

    public id: string;
    public numberOfMessagesSent: bigint;
    public numberOfDeliveredMessages: bigint;
    public numberOfFailedDeliveries: bigint;
    public numberOfTimedOutMessages: bigint;
    public totalTransfersIn: bigint;
    public protocolFeesEarned: bigint;
    public feesPayedOutToRelayers: bigint;
    

    get _name(): string {
        return 'HyperBridgeChainStats';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save HyperBridgeChainStats entity without an ID");
        await store.set('HyperBridgeChainStats', id.toString(), this as unknown as CompatHyperBridgeChainStatsProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove HyperBridgeChainStats entity without an ID");
        await store.remove('HyperBridgeChainStats', id.toString());
    }

    static async get(id: string): Promise<HyperBridgeChainStats | undefined> {
        assert((id !== null && id !== undefined), "Cannot get HyperBridgeChainStats entity without an ID");
        const record = await store.get('HyperBridgeChainStats', id.toString());
        if (record) {
            return this.create(record as unknown as HyperBridgeChainStatsProps);
        } else {
            return;
        }
    }

    static async getByNumberOfMessagesSent(numberOfMessagesSent: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'numberOfMessagesSent', numberOfMessagesSent, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    

    static async getByNumberOfDeliveredMessages(numberOfDeliveredMessages: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'numberOfDeliveredMessages', numberOfDeliveredMessages, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    

    static async getByNumberOfFailedDeliveries(numberOfFailedDeliveries: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'numberOfFailedDeliveries', numberOfFailedDeliveries, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    

    static async getByNumberOfTimedOutMessages(numberOfTimedOutMessages: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'numberOfTimedOutMessages', numberOfTimedOutMessages, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    

    static async getByTotalTransfersIn(totalTransfersIn: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'totalTransfersIn', totalTransfersIn, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    

    static async getByProtocolFeesEarned(protocolFeesEarned: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'protocolFeesEarned', protocolFeesEarned, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    

    static async getByFeesPayedOutToRelayers(feesPayedOutToRelayers: bigint, options: GetOptions<CompatHyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', 'feesPayedOutToRelayers', feesPayedOutToRelayers, options);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<HyperBridgeChainStatsProps>[], options: GetOptions<HyperBridgeChainStatsProps>): Promise<HyperBridgeChainStats[]> {
        const records = await store.getByFields<CompatHyperBridgeChainStatsProps>('HyperBridgeChainStats', filter  as unknown as FieldsExpression<CompatHyperBridgeChainStatsProps>[], options as unknown as GetOptions<CompatHyperBridgeChainStatsProps>);
        return records.map(record => this.create(record as unknown as HyperBridgeChainStatsProps));
    }

    static create(record: HyperBridgeChainStatsProps): HyperBridgeChainStats {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.numberOfMessagesSent,
            record.numberOfDeliveredMessages,
            record.numberOfFailedDeliveries,
            record.numberOfTimedOutMessages,
            record.totalTransfersIn,
            record.protocolFeesEarned,
            record.feesPayedOutToRelayers,
        );
        Object.assign(entity,record);
        return entity;
    }
}
