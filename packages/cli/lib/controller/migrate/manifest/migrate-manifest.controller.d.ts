import { CommonSubqueryProject } from '@subql/types-core';
import { TemplateKind } from '../../codegen-controller';
import { MigrateDatasourceKind, SubgraphDataSource, SubgraphProject, SubgraphTemplate, ChainInfo, DsConvertFunction, TemplateConvertFunction } from '../types';
export declare function subgraphValidation(subgraphProject: SubgraphProject): void;
export declare function readSubgraphManifest(inputPath: string, subgraphPath: string): SubgraphProject;
export declare function extractNetworkFromManifest(subgraphProject: SubgraphProject): ChainInfo;
/**
 * Render subquery project to .ts file
 * @param projectPath
 * @param project
 */
export declare function renderManifest(projectPath: string, project: CommonSubqueryProject): Promise<void>;
/**
 *  Migrate a subgraph project manifest to subquery manifest file
 * @param network network family
 * @param inputPath file path to subgraph.yaml
 * @param outputPath file path to project.ts
 */
export declare function migrateManifest(chainInfo: ChainInfo, subgraphManifest: SubgraphProject, outputPath: string): Promise<void>;
export declare function subgraphTemplateToSubqlTemplate(convertFunction: TemplateConvertFunction, subgraphTemplates: SubgraphTemplate[]): TemplateKind[];
export declare function subgraphDsToSubqlDs(convertFunction: DsConvertFunction, subgraphDs: SubgraphDataSource[]): MigrateDatasourceKind[];
