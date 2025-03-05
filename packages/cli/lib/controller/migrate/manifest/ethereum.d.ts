import type { SubqlRuntimeDatasource as EthereumDs, CustomDatasourceTemplate as EthereumCustomDsTemplate, RuntimeDatasourceTemplate as EthereumDsTemplate } from '@subql/types-ethereum';
import { MigrateDatasourceKind, SubgraphDataSource, SubgraphTemplate } from '../types';
type EthTemplate = EthereumDsTemplate | EthereumCustomDsTemplate;
export declare function convertEthereumDs(ds: SubgraphDataSource): MigrateDatasourceKind<EthereumDs>;
export declare function convertEthereumTemplate(ds: SubgraphTemplate): MigrateDatasourceKind<EthTemplate>;
export {};
