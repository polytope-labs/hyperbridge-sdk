// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';


import {
    Status,
} from '../enums';

export type RequestStatusMetadataProps = Omit<RequestStatusMetadata, NonNullable<FunctionPropertyNames<RequestStatusMetadata>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatRequestStatusMetadataProps = Omit<RequestStatusMetadataProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class RequestStatusMetadata implements CompatEntity {

    constructor(
        
        id: string,
        status: Status,
        chain: string,
        timestamp: bigint,
        blockNumber: string,
        blockHash: string,
        transactionHash: string,
        requestId: string,
    ) {
        this.id = id;
        this.status = status;
        this.chain = chain;
        this.timestamp = timestamp;
        this.blockNumber = blockNumber;
        this.blockHash = blockHash;
        this.transactionHash = transactionHash;
        this.requestId = requestId;
        
    }

    public id: string;
    public status: Status;
    public chain: string;
    public timestamp: bigint;
    public blockNumber: string;
    public blockHash: string;
    public transactionHash: string;
    public requestId: string;
    

    get _name(): string {
        return 'RequestStatusMetadata';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save RequestStatusMetadata entity without an ID");
        await store.set('RequestStatusMetadata', id.toString(), this as unknown as CompatRequestStatusMetadataProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove RequestStatusMetadata entity without an ID");
        await store.remove('RequestStatusMetadata', id.toString());
    }

    static async get(id: string): Promise<RequestStatusMetadata | undefined> {
        assert((id !== null && id !== undefined), "Cannot get RequestStatusMetadata entity without an ID");
        const record = await store.get('RequestStatusMetadata', id.toString());
        if (record) {
            return this.create(record as unknown as RequestStatusMetadataProps);
        } else {
            return;
        }
    }

    static async getByRequestId(requestId: string, options: GetOptions<CompatRequestStatusMetadataProps>): Promise<RequestStatusMetadata[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRequestStatusMetadataProps>('RequestStatusMetadata', 'requestId', requestId, options);
        return records.map(record => this.create(record as unknown as RequestStatusMetadataProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<RequestStatusMetadataProps>[], options: GetOptions<RequestStatusMetadataProps>): Promise<RequestStatusMetadata[]> {
        const records = await store.getByFields<CompatRequestStatusMetadataProps>('RequestStatusMetadata', filter  as unknown as FieldsExpression<CompatRequestStatusMetadataProps>[], options as unknown as GetOptions<CompatRequestStatusMetadataProps>);
        return records.map(record => this.create(record as unknown as RequestStatusMetadataProps));
    }

    static create(record: RequestStatusMetadataProps): RequestStatusMetadata {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.status,
            record.chain,
            record.timestamp,
            record.blockNumber,
            record.blockHash,
            record.transactionHash,
            record.requestId,
        );
        Object.assign(entity,record);
        return entity;
    }
}
