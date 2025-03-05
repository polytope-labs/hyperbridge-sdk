// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';


import {
    Status,
} from '../enums';

export type ResponseStatusMetadataProps = Omit<ResponseStatusMetadata, NonNullable<FunctionPropertyNames<ResponseStatusMetadata>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatResponseStatusMetadataProps = Omit<ResponseStatusMetadataProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class ResponseStatusMetadata implements CompatEntity {

    constructor(
        
        id: string,
        status: Status,
        chain: string,
        timestamp: bigint,
        blockNumber: string,
        blockHash: string,
        transactionHash: string,
        responseId: string,
    ) {
        this.id = id;
        this.status = status;
        this.chain = chain;
        this.timestamp = timestamp;
        this.blockNumber = blockNumber;
        this.blockHash = blockHash;
        this.transactionHash = transactionHash;
        this.responseId = responseId;
        
    }

    public id: string;
    public status: Status;
    public chain: string;
    public timestamp: bigint;
    public blockNumber: string;
    public blockHash: string;
    public transactionHash: string;
    public responseId: string;
    

    get _name(): string {
        return 'ResponseStatusMetadata';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save ResponseStatusMetadata entity without an ID");
        await store.set('ResponseStatusMetadata', id.toString(), this as unknown as CompatResponseStatusMetadataProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove ResponseStatusMetadata entity without an ID");
        await store.remove('ResponseStatusMetadata', id.toString());
    }

    static async get(id: string): Promise<ResponseStatusMetadata | undefined> {
        assert((id !== null && id !== undefined), "Cannot get ResponseStatusMetadata entity without an ID");
        const record = await store.get('ResponseStatusMetadata', id.toString());
        if (record) {
            return this.create(record as unknown as ResponseStatusMetadataProps);
        } else {
            return;
        }
    }

    static async getByResponseId(responseId: string, options: GetOptions<CompatResponseStatusMetadataProps>): Promise<ResponseStatusMetadata[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseStatusMetadataProps>('ResponseStatusMetadata', 'responseId', responseId, options);
        return records.map(record => this.create(record as unknown as ResponseStatusMetadataProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<ResponseStatusMetadataProps>[], options: GetOptions<ResponseStatusMetadataProps>): Promise<ResponseStatusMetadata[]> {
        const records = await store.getByFields<CompatResponseStatusMetadataProps>('ResponseStatusMetadata', filter  as unknown as FieldsExpression<CompatResponseStatusMetadataProps>[], options as unknown as GetOptions<CompatResponseStatusMetadataProps>);
        return records.map(record => this.create(record as unknown as ResponseStatusMetadataProps));
    }

    static create(record: ResponseStatusMetadataProps): ResponseStatusMetadata {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.status,
            record.chain,
            record.timestamp,
            record.blockNumber,
            record.blockHash,
            record.transactionHash,
            record.responseId,
        );
        Object.assign(entity,record);
        return entity;
    }
}
