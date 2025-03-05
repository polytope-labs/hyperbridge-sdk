import { NETWORK_FAMILY } from '@subql/common';
import { NetworkUtils } from './types';
export declare const networkConverters: Partial<Record<NETWORK_FAMILY, NetworkUtils>>;
export declare const graphToSubqlNetworkFamily: Record<string, NETWORK_FAMILY>;
export declare const graphNetworkNameChainId: Partial<Record<NETWORK_FAMILY, Record<string, string>>>;
