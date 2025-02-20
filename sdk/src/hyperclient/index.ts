import * as dotenv from 'dotenv';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import {
 HyperClient,
 IConfig,
} from '@polytope-labs/hyperclient';
import {
 EVM_CHAINS,
 HYPERBRIDGE,
 HYPERBRIDGE_TESTNET,
 SUBSTRATE_CHAINS,
} from './constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Store HyperClient instances
const instances = new Map<string, HyperClient>();

export const getHyperClient = async (
 sourceChain: string,
 destChain: string
): Promise<HyperClient> => {
 const key = `${sourceChain}-${destChain}`;

 if (!instances.has(key)) {
  const config: IConfig = {
   source: EVM_CHAINS[sourceChain] || SUBSTRATE_CHAINS[sourceChain],
   dest: EVM_CHAINS[destChain] || SUBSTRATE_CHAINS[destChain],
   hyperbridge: {
    rpc_url: process.env.HYPERBRIDGE_GARGANTUA!,
    state_machine: HYPERBRIDGE_TESTNET,
    consensus_state_id: 'PARA',
   },
   tracing: false,
  };

  const client = await HyperClient.init(config);
  instances.set(key, client);
 }

 return instances.get(key)!;
};
