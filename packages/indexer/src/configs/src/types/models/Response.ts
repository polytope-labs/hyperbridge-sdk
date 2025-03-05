// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';


import {
    Status,
} from '../enums';

export type ResponseProps = Omit<Response, NonNullable<FunctionPropertyNames<Response>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatResponseProps = Omit<ResponseProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class Response implements CompatEntity {

    constructor(
        
        id: string,
        chain: string,
        commitment: string,
        sourceTransactionHash: string,
        hyperbridgeTransactionHash: string,
        destinationTransactionHash: string,
        status: Status,
    ) {
        this.id = id;
        this.chain = chain;
        this.commitment = commitment;
        this.sourceTransactionHash = sourceTransactionHash;
        this.hyperbridgeTransactionHash = hyperbridgeTransactionHash;
        this.destinationTransactionHash = destinationTransactionHash;
        this.status = status;
        
    }

    public id: string;
    public chain: string;
    public commitment: string;
    public sourceTransactionHash: string;
    public hyperbridgeTransactionHash: string;
    public destinationTransactionHash: string;
    public hyperbridgeTimeoutTransactionHash?: string;
    public destinationTimeoutTransactionHash?: string;
    public response_message?: string;
    public responseTimeoutTimestamp?: bigint;
    public status: Status;
    public requestId?: string;
    

    get _name(): string {
        return 'Response';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save Response entity without an ID");
        await store.set('Response', id.toString(), this as unknown as CompatResponseProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove Response entity without an ID");
        await store.remove('Response', id.toString());
    }

    static async get(id: string): Promise<Response | undefined> {
        assert((id !== null && id !== undefined), "Cannot get Response entity without an ID");
        const record = await store.get('Response', id.toString());
        if (record) {
            return this.create(record as unknown as ResponseProps);
        } else {
            return;
        }
    }

    static async getByChain(chain: string, options: GetOptions<CompatResponseProps>): Promise<Response[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseProps>('Response', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }
    

    static async getByCommitment(commitment: string, options: GetOptions<CompatResponseProps>): Promise<Response[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseProps>('Response', 'commitment', commitment, options);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }
    

    static async getBySourceTransactionHash(sourceTransactionHash: string, options: GetOptions<CompatResponseProps>): Promise<Response[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseProps>('Response', 'sourceTransactionHash', sourceTransactionHash, options);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }
    

    static async getByHyperbridgeTransactionHash(hyperbridgeTransactionHash: string, options: GetOptions<CompatResponseProps>): Promise<Response[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseProps>('Response', 'hyperbridgeTransactionHash', hyperbridgeTransactionHash, options);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }
    

    static async getByDestinationTransactionHash(destinationTransactionHash: string, options: GetOptions<CompatResponseProps>): Promise<Response[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseProps>('Response', 'destinationTransactionHash', destinationTransactionHash, options);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }
    

    static async getByRequestId(requestId: string, options: GetOptions<CompatResponseProps>): Promise<Response[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatResponseProps>('Response', 'requestId', requestId, options);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<ResponseProps>[], options: GetOptions<ResponseProps>): Promise<Response[]> {
        const records = await store.getByFields<CompatResponseProps>('Response', filter  as unknown as FieldsExpression<CompatResponseProps>[], options as unknown as GetOptions<CompatResponseProps>);
        return records.map(record => this.create(record as unknown as ResponseProps));
    }

    static create(record: ResponseProps): Response {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.chain,
            record.commitment,
            record.sourceTransactionHash,
            record.hyperbridgeTransactionHash,
            record.destinationTransactionHash,
            record.status,
        );
        Object.assign(entity,record);
        return entity;
    }
}
