import { NETWORK_FAMILY } from '@subql/common';
import { ChainInfo, SubgraphProject } from './types';
export declare function extractGitInfo(input: string): {
    link: string;
    branch?: string;
} | undefined;
export declare function improveProjectInfo(subgraphDir: string, subgraphManifest: SubgraphProject): void;
export declare function prepareProject(chainInfo: ChainInfo, subqlDir: string): Promise<void>;
export declare function getChainIdByNetworkName(networkFamily: NETWORK_FAMILY, chainName: string): string;
