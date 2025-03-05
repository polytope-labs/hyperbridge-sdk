// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';



export type TransferProps = Omit<Transfer, NonNullable<FunctionPropertyNames<Transfer>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatTransferProps = Omit<TransferProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class Transfer implements CompatEntity {

    constructor(
        
        id: string,
        chain: string,
        amount: bigint,
        from: string,
        to: string,
    ) {
        this.id = id;
        this.chain = chain;
        this.amount = amount;
        this.from = from;
        this.to = to;
        
    }

    public id: string;
    public chain: string;
    public amount: bigint;
    public from: string;
    public to: string;
    

    get _name(): string {
        return 'Transfer';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save Transfer entity without an ID");
        await store.set('Transfer', id.toString(), this as unknown as CompatTransferProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove Transfer entity without an ID");
        await store.remove('Transfer', id.toString());
    }

    static async get(id: string): Promise<Transfer | undefined> {
        assert((id !== null && id !== undefined), "Cannot get Transfer entity without an ID");
        const record = await store.get('Transfer', id.toString());
        if (record) {
            return this.create(record as unknown as TransferProps);
        } else {
            return;
        }
    }

    static async getByChain(chain: string, options: GetOptions<CompatTransferProps>): Promise<Transfer[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatTransferProps>('Transfer', 'chain', chain, options);
        return records.map(record => this.create(record as unknown as TransferProps));
    }
    

    static async getByAmount(amount: bigint, options: GetOptions<CompatTransferProps>): Promise<Transfer[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatTransferProps>('Transfer', 'amount', amount, options);
        return records.map(record => this.create(record as unknown as TransferProps));
    }
    

    static async getByFrom(from: string, options: GetOptions<CompatTransferProps>): Promise<Transfer[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatTransferProps>('Transfer', 'from', from, options);
        return records.map(record => this.create(record as unknown as TransferProps));
    }
    

    static async getByTo(to: string, options: GetOptions<CompatTransferProps>): Promise<Transfer[]> {
        // Inputs must be cast as the store interface has not been updated to support alternative ID types
        const records = await store.getByField<CompatTransferProps>('Transfer', 'to', to, options);
        return records.map(record => this.create(record as unknown as TransferProps));
    }
    


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<TransferProps>[], options: GetOptions<TransferProps>): Promise<Transfer[]> {
        const records = await store.getByFields<CompatTransferProps>('Transfer', filter  as unknown as FieldsExpression<CompatTransferProps>[], options as unknown as GetOptions<CompatTransferProps>);
        return records.map(record => this.create(record as unknown as TransferProps));
    }

    static create(record: TransferProps): Transfer {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
            record.chain,
            record.amount,
            record.from,
            record.to,
        );
        Object.assign(entity,record);
        return entity;
    }
}
