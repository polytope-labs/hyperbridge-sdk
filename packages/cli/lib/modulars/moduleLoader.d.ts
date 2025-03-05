import { NETWORK_FAMILY } from '@subql/common';
import { ModuleCache } from './types';
export declare function loadDependency<N extends NETWORK_FAMILY>(network: N): ModuleCache[N];
