// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';



export type StateMachineUpdateEventProps = Omit<StateMachineUpdateEvent, NonNullable<FunctionPropertyNames<StateMachineUpdateEvent>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatStateMachineUpdateEventProps = Omit<StateMachineUpdateEventProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class StateMachineUpdateEvent implements CompatEntity {

    constructor(
        
        id: string,
        stateMachineId: string,
        height: number,
        chain: string,
        blockHash: string,
        blockNumber: number,
        transactionHash: string,
        transactionIndex: number,
        commitmentTimestamp: bigint,
        createdAt: Date,
    ) {
        this.id = id;
        this.stateMachineId = stateMachineId;
        this.height = height;
        this.chain = chain;
        this.blockHash = blockHash;
        this.blockNumber = blockNumber;
        this.transactionHash = transactionHash;
        this.transactionIndex = transactionIndex;
        this.commitmentTimestamp = commitmentTimestamp;
        this.createdAt = createdAt;
        
    }

    public id: string;
    public stateMachineId: string;
    public height: number;
    public chain: string;
    public blockHash: string;
    public blockNumber: number;
    public transactionHash: string;
    public transactionIndex: number;
    public commitmentTimestamp: bigint;
    public createdAt: Date;
    

    get _name(): string {
        return 'StateMachineUpdateEvent';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save StateMachineUpdateEvent entity without an ID");
        await store.set('StateMachineUpdateEvent', id.toString(), this as unknown as CompatStateMachineUpdateEventProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove StateMachineUpdateEvent entity without an ID");
        await store.remove('StateMachineUpdateEvent', id.toString());
    }

    static async get(id: string): Promise<StateMachineUpdateEvent | undefined> {
        assert((id !== null && id !== undefined), "Cannot get StateMachineUpdateEvent entity without an ID");
        const record = await store.get('StateMachineUpdateEvent', id.toString());
        if (record) {
            return this.create(record as unknown as StateMachineUpdateEventProps);
        } else {
            return;
        }
    }

    static async getByStateMachineId(stateMachineId: string, options: GetOptions<CompatStateMachineUpdateEventProps>): Promise<StateMachineUpdateEvent[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatStateMachineUpdateEventProps>('StateMachineUpdateEvent', 'stateMachineId', stateMachineId, options);
        return records.map(record => this.create(record as unknown as StateMachineUpdateEventProps));
    }
    

    static async getByHeight(height: number, options: GetOptions<CompatStateMachineUpdateEventProps>): Promise<StateMachineUpdateEvent[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatStateMachineUpdateEventProps>('StateMachineUpdateEvent', 'height', height, options);
        return records.map(record => this.create(record as unknown as StateMachineUpdateEventProps));
    }
    

    static async getByChain(chain: string, options: GetOptions<CompatStateMachineUpdateEventProps>): Promise<StateMachineUpdateEvent[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatStateMachineUpdateEventProps>('StateMachineUpdateEvent', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as StateMachineUpdateEventProps));
    }
    

    static async getByBlockNumber(blockNumber: number, options: GetOptions<CompatStateMachineUpdateEventProps>): Promise<StateMachineUpdateEvent[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatStateMachineUpdateEventProps>('StateMachineUpdateEvent', 'blockNumber', blockNumber, options);
        return records.map(record => this.create(record as unknown as StateMachineUpdateEventProps));
    }
    

    static async getByCreatedAt(createdAt: Date, options: GetOptions<CompatStateMachineUpdateEventProps>): Promise<StateMachineUpdateEvent[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatStateMachineUpdateEventProps>('StateMachineUpdateEvent', 'createdAt', createdAt, options);
        return records.map(record => this.create(record as unknown as StateMachineUpdateEventProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<StateMachineUpdateEventProps>[], options: GetOptions<StateMachineUpdateEventProps>): Promise<StateMachineUpdateEvent[]> {
        const records = await store.getByFields<CompatStateMachineUpdateEventProps>('StateMachineUpdateEvent', filter  as unknown as FieldsExpression<CompatStateMachineUpdateEventProps>[], options as unknown as GetOptions<CompatStateMachineUpdateEventProps>);
        return records.map(record => this.create(record as unknown as StateMachineUpdateEventProps));
    }

    static create(record: StateMachineUpdateEventProps): StateMachineUpdateEvent {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.stateMachineId,
            record.height,
            record.chain,
            record.blockHash,
            record.blockNumber,
            record.transactionHash,
            record.transactionIndex,
            record.commitmentTimestamp,
            record.createdAt,
        );
        Object.assign(entity,record);
        return entity;
    }
}
