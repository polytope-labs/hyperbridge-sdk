// Auto-generated , DO NOT EDIT
import {Entity, FunctionPropertyNames, FieldsExpression, GetOptions } from "@subql/types-core";
import assert from 'assert';



export type RelayerProps = Omit<Relayer, NonNullable<FunctionPropertyNames<Relayer>> | '_name'>;

/*
 * Compat types allows for support of alternative `id` types without refactoring the node
 */
type CompatRelayerProps = Omit<RelayerProps, 'id'> & { id: string; };
type CompatEntity = Omit<Entity, 'id'> & { id: string; };

export class Relayer implements CompatEntity {

    constructor(
        
        id: string,
    ) {
        this.id = id;
        
    }

    public id: string;
    

    get _name(): string {
        return 'Relayer';
    }

    async save(): Promise<void> {
        const id = this.id;
        assert(id !== null, "Cannot save Relayer entity without an ID");
        await store.set('Relayer', id.toString(), this as unknown as CompatRelayerProps);
    }

    static async remove(id: string): Promise<void> {
        assert(id !== null, "Cannot remove Relayer entity without an ID");
        await store.remove('Relayer', id.toString());
    }

    static async get(id: string): Promise<Relayer | undefined> {
        assert((id !== null && id !== undefined), "Cannot get Relayer entity without an ID");
        const record = await store.get('Relayer', id.toString());
        if (record) {
            return this.create(record as unknown as RelayerProps);
        } else {
            return;
        }
    }


    /**
     * Gets entities matching the specified filters and options.
     *
     * ⚠️ This function will first search cache data followed by DB data. Please consider this when using order and offset options.⚠️
     * */
    static async getByFields(filter: FieldsExpression<RelayerProps>[], options: GetOptions<RelayerProps>): Promise<Relayer[]> {
        const records = await store.getByFields<CompatRelayerProps>('Relayer', filter  as unknown as FieldsExpression<CompatRelayerProps>[], options as unknown as GetOptions<CompatRelayerProps>);
        return records.map(record => this.create(record as unknown as RelayerProps));
    }

    static create(record: RelayerProps): Relayer {
        assert(record.id !== undefined && record.id !== null, "id must be provided");
        const entity = new this(
            record.id,
        );
        Object.assign(entity,record);
        return entity;
    }
}
