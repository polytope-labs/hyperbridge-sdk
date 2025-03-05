// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';


import {
    ProtocolParticipant,
} from '../enums';

export type RewardPointsProps = Omit<RewardPoints, NonNullable<FunctionPropertyNames<RewardPoints>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatRewardPointsProps = Omit<RewardPointsProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class RewardPoints implements CompatEntity {

    constructor(
        
        id: string,
        address: string,
        chain: string,
        points: bigint,
        earnerType: ProtocolParticipant,
    ) {
        this.id = id;
        this.address = address;
        this.chain = chain;
        this.points = points;
        this.earnerType = earnerType;
        
    }

    public id: string;
    public address: string;
    public chain: string;
    public points: bigint;
    public earnerType: ProtocolParticipant;
    

    get _name(): string {
        return 'RewardPoints';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save RewardPoints entity without an ID");
        await store.set('RewardPoints', id.toString(), this as unknown as CompatRewardPointsProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove RewardPoints entity without an ID");
        await store.remove('RewardPoints', id.toString());
    }

    static async get(id: string): Promise<RewardPoints | undefined> {
        assert((id !== null && id !== undefined), "Cannot get RewardPoints entity without an ID");
        const record = await store.get('RewardPoints', id.toString());
        if (record) {
            return this.create(record as unknown as RewardPointsProps);
        } else {
            return;
        }
    }

    static async getByAddress(address: string, options: GetOptions<CompatRewardPointsProps>): Promise<RewardPoints[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsProps>('RewardPoints', 'address', address, options);
        return records.map(record => this.create(record as unknown as RewardPointsProps));
    }
    

    static async getByChain(chain: string, options: GetOptions<CompatRewardPointsProps>): Promise<RewardPoints[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsProps>('RewardPoints', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as RewardPointsProps));
    }
    

    static async getByPoints(points: bigint, options: GetOptions<CompatRewardPointsProps>): Promise<RewardPoints[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRewardPointsProps>('RewardPoints', 'points', points, options);
        return records.map(record => this.create(record as unknown as RewardPointsProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<RewardPointsProps>[], options: GetOptions<RewardPointsProps>): Promise<RewardPoints[]> {
        const records = await store.getByFields<CompatRewardPointsProps>('RewardPoints', filter  as unknown as FieldsExpression<CompatRewardPointsProps>[], options as unknown as GetOptions<CompatRewardPointsProps>);
        return records.map(record => this.create(record as unknown as RewardPointsProps));
    }

    static create(record: RewardPointsProps): RewardPoints {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.address,
            record.chain,
            record.points,
            record.earnerType,
        );
        Object.assign(entity,record);
        return entity;
    }
}
