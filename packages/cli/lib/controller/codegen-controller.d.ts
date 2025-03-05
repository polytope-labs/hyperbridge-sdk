import type { SubstrateCustomDatasource } from '@subql/types';
import { BaseTemplateDataSource } from '@subql/types-core';
import type { SubqlCustomDatasource as EthereumCustomDs, SubqlRuntimeDatasource as EthereumDs } from '@subql/types-ethereum';
import { GraphQLEntityField, GraphQLEntityIndex, GraphQLJsonFieldType } from '@subql/utils';
export type TemplateKind = BaseTemplateDataSource;
export type DatasourceKind = SubstrateCustomDatasource | EthereumDs | EthereumCustomDs;
export interface ProcessedField {
    name: string;
    type: string;
    required: boolean;
    isEnum: boolean;
    indexed: boolean;
    unique?: boolean;
    isArray: boolean;
    isJsonInterface: boolean;
}
export declare function generateJsonInterfaces(projectPath: string, schema: string): Promise<void>;
export declare function generateEnums(projectPath: string, schema: string): Promise<void>;
export declare function processFields(type: 'entity' | 'jsonField', className: string, fields: (GraphQLEntityField | GraphQLJsonFieldType)[], indexFields?: GraphQLEntityIndex[]): ProcessedField[];
export declare function codegen(projectPath: string, fileNames?: string[]): Promise<void>;
export declare function generateSchemaModels(projectPath: string, schemaPath: string): Promise<void>;
export declare function validateEntityName(name: string): string;
export declare function generateModels(projectPath: string, schema: string): Promise<void>;
export declare function generateDatasourceTemplates(projectPath: string, templates: TemplateKind[]): Promise<void>;
