// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';


import {
    Status,
} from '../enums';

export type RequestProps = Omit<Request, NonNullable<FunctionPropertyNames<Request>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatRequestProps = Omit<RequestProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class Request implements CompatEntity {

    constructor(
        
        id: string,
        commitment: string,
        sourceTransactionHash: string,
        chain: string,
        from: string,
        to: string,
        nonce: bigint,
        body: string,
        fee: bigint,
        status: Status,
    ) {
        this.id = id;
        this.commitment = commitment;
        this.sourceTransactionHash = sourceTransactionHash;
        this.chain = chain;
        this.from = from;
        this.to = to;
        this.nonce = nonce;
        this.body = body;
        this.fee = fee;
        this.status = status;
        
    }

    public id: string;
    public commitment: string;
    public sourceTransactionHash: string;
    public chain: string;
    public source?: string;
    public dest?: string;
    public timeoutTimestamp?: bigint;
    public from: string;
    public to: string;
    public nonce: bigint;
    public body: string;
    public fee: bigint;
    public status: Status;
    

    get _name(): string {
        return 'Request';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save Request entity without an ID");
        await store.set('Request', id.toString(), this as unknown as CompatRequestProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove Request entity without an ID");
        await store.remove('Request', id.toString());
    }

    static async get(id: string): Promise<Request | undefined> {
        assert((id !== null && id !== undefined), "Cannot get Request entity without an ID");
        const record = await store.get('Request', id.toString());
        if (record) {
            return this.create(record as unknown as RequestProps);
        } else {
            return;
        }
    }

    static async getByCommitment(commitment: string, options: GetOptions<CompatRequestProps>): Promise<Request[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRequestProps>('Request', 'commitment', commitment, options);
        return records.map(record => this.create(record as unknown as RequestProps));
    }
    

    static async getBySourceTransactionHash(sourceTransactionHash: string, options: GetOptions<CompatRequestProps>): Promise<Request[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRequestProps>('Request', 'sourceTransactionHash', sourceTransactionHash, options);
        return records.map(record => this.create(record as unknown as RequestProps));
    }
    

    static async getByChain(chain: string, options: GetOptions<CompatRequestProps>): Promise<Request[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatRequestProps>('Request', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as RequestProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<RequestProps>[], options: GetOptions<RequestProps>): Promise<Request[]> {
        const records = await store.getByFields<CompatRequestProps>('Request', filter  as unknown as FieldsExpression<CompatRequestProps>[], options as unknown as GetOptions<CompatRequestProps>);
        return records.map(record => this.create(record as unknown as RequestProps));
    }

    static create(record: RequestProps): Request {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.commitment,
            record.sourceTransactionHash,
            record.chain,
            record.from,
            record.to,
            record.nonce,
            record.body,
            record.fee,
            record.status,
        );
        Object.assign(entity,record);
        return entity;
    }
}
