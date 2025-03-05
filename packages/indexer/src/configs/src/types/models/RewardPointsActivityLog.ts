// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';


import {
    ProtocolParticipant,

    RewardPointsActivityType,
} from '../enums';

export type RewardPointsActivityLogProps = Omit<RewardPointsActivityLog, NonNullable<FunctionPropertyNames<RewardPointsActivityLog>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatRewardPointsActivityLogProps = Omit<RewardPointsActivityLogProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class RewardPointsActivityLog implements CompatEntity {

    constructor(
        
        id: string,
        chain: string,
        points: bigint,
        transactionHash: string,
        earnerAddress: string,
        earnerType: ProtocolParticipant,
        activityType: RewardPointsActivityType,
        description: string,
        createdAt: Date,
    ) {
        this.id = id;
        this.chain = chain;
        this.points = points;
        this.transactionHash = transactionHash;
        this.earnerAddress = earnerAddress;
        this.earnerType = earnerType;
        this.activityType = activityType;
        this.description = description;
        this.createdAt = createdAt;
        
    }

    public id: string;
    public chain: string;
    public points: bigint;
    public transactionHash: string;
    public earnerAddress: string;
    public earnerType: ProtocolParticipant;
    public activityType: RewardPointsActivityType;
    public description: string;
    public createdAt: Date;
    

    get _name(): string {
        return 'RewardPointsActivityLog';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save RewardPointsActivityLog entity without an ID");
        await store.set('RewardPointsActivityLog', id.toString(), this as unknown as CompatRewardPointsActivityLogProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove RewardPointsActivityLog entity without an ID");
        await store.remove('RewardPointsActivityLog', id.toString());
    }

    static async get(id: string): Promise<RewardPointsActivityLog | undefined> {
        assert((id !== null && id !== undefined), "Cannot get RewardPointsActivityLog entity without an ID");
        const record = await store.get('RewardPointsActivityLog', id.toString());
        if (record) {
            return this.create(record as unknown as RewardPointsActivityLogProps);
        } else {
            return;
        }
    }

    static async getByChain(chain: string, options: GetOptions<CompatRewardPointsActivityLogProps>): Promise<RewardPointsActivityLog[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsActivityLogProps>('RewardPointsActivityLog', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as RewardPointsActivityLogProps));
    }
    

    static async getByPoints(points: bigint, options: GetOptions<CompatRewardPointsActivityLogProps>): Promise<RewardPointsActivityLog[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsActivityLogProps>('RewardPointsActivityLog', 'points', points, options);
        return records.map(record => this.create(record as unknown as RewardPointsActivityLogProps));
    }
    

    static async getByTransactionHash(transactionHash: string, options: GetOptions<CompatRewardPointsActivityLogProps>): Promise<RewardPointsActivityLog[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsActivityLogProps>('RewardPointsActivityLog', 'transactionHash', transactionHash, options);
        return records.map(record => this.create(record as unknown as RewardPointsActivityLogProps));
    }
    

    static async getByEarnerAddress(earnerAddress: string, options: GetOptions<CompatRewardPointsActivityLogProps>): Promise<RewardPointsActivityLog[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsActivityLogProps>('RewardPointsActivityLog', 'earnerAddress', earnerAddress, options);
        return records.map(record => this.create(record as unknown as RewardPointsActivityLogProps));
    }
    

    static async getByCreatedAt(createdAt: Date, options: GetOptions<CompatRewardPointsActivityLogProps>): Promise<RewardPointsActivityLog[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsActivityLogProps>('RewardPointsActivityLog', 'createdAt', createdAt, options);
        return records.map(record => this.create(record as unknown as RewardPointsActivityLogProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<RewardPointsActivityLogProps>[], options: GetOptions<RewardPointsActivityLogProps>): Promise<RewardPointsActivityLog[]> {
        const records = await store.getByFields<CompatRewardPointsActivityLogProps>('RewardPointsActivityLog', filter  as unknown as FieldsExpression<CompatRewardPointsActivityLogProps>[], options as unknown as GetOptions<CompatRewardPointsActivityLogProps>);
        return records.map(record => this.create(record as unknown as RewardPointsActivityLogProps));
    }

    static create(record: RewardPointsActivityLogProps): RewardPointsActivityLog {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.chain,
            record.points,
            record.transactionHash,
            record.earnerAddress,
            record.earnerType,
            record.activityType,
            record.description,
            record.createdAt,
        );
        Object.assign(entity,record);
        return entity;
    }
}
