import * as dotenv from 'dotenv';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import {
 HyperClient,
 IConfig,
 IPostRequest,
 MessageStatusWithMeta,
 MessageStatusStreamState,
} from '@polytope-labs/hyperclient';
import { EVM_CHAINS, SUBSTRATE_CHAINS } from './constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export class HyperClientService {
 private client!: HyperClient;
 private static instances: Map<string, HyperClientService> = new Map();

 private constructor(private config: IConfig) {}

 static async getInstance(
  sourceChain: string,
  destChain: string
 ): Promise<HyperClientService> {
  const key = `${sourceChain}-${destChain}`;

  if (!this.instances.has(key)) {
   const config = {
    source: EVM_CHAINS[sourceChain] || SUBSTRATE_CHAINS[sourceChain],
    dest: EVM_CHAINS[destChain] || SUBSTRATE_CHAINS[destChain],
    hyperbridge: {
     rpc_url: process.env.HYPERBRIDGE_RPC_URL!,
     state_machine: 'POLKADOT-3367',
     consensus_state_id: 'PARA',
    },
   };

   const service = new HyperClientService(config);
   await service.initialize();

   console.log('service', service);
   this.instances.set(key, service);
  }

  return this.instances.get(key)!;
 }

 async initialize(): Promise<void> {
  this.client = await HyperClient.init(this.config);
 }

 async getPostRequestStatusStream(
  request: IPostRequest,
  state: MessageStatusStreamState
 ): Promise<ReadableStream<MessageStatusWithMeta>> {
  return await this.client.post_request_status_stream(request, state);
 }
}
