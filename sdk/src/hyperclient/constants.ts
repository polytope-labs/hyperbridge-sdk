import { IEvmConfig, ISubstrateConfig } from '@polytope-labs/hyperclient';
import * as dotenv from 'dotenv';
import path from 'path';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type ChainConfig = {
 [chainId: string]: IEvmConfig | ISubstrateConfig;
};

const ISMPHosts = {
 'EVM-1': '0x792A6236AF69787C40cF76b69B4c8c7B28c4cA20',
 'EVM-8453': '0x6FFe92e4d7a9D589549644544780e6725E84b248',
 'EVM-56': '0x24B5d421Ec373FcA57325dd2F0C074009Af021F7',
 'EVM-10': '0x78c8A5F27C06757EA0e30bEa682f1FD5C8d7645d',
 'EVM-42161': '0xE05AFD4Eb2ce6d65c40e1048381BD0Ef8b4B299e',
 'EVM-100': '0x50c236247447B9d4Ee0561054ee596fbDa7791b1',
 'EVM-1868': '0x7F0165140D0f3251c8f6465e94E9d12C7FD40711',
};

export const EVM_CHAINS: ChainConfig = {
 'EVM-1': {
  rpc_url: process.env.ETHEREUM_RPC_URL || '',
  state_machine: 'EVM-1',
  host_address: ISMPHosts['EVM-1'],
  consensus_state_id: 'ETH0',
 },
 'EVM-8453': {
  rpc_url: process.env.BASE_RPC_URL!,
  state_machine: 'EVM-8453',
  host_address: ISMPHosts['EVM-8453'],
  consensus_state_id: 'ETH0',
 },
 'EVM-56': {
  rpc_url: process.env.BSC_RPC_URL || '',
  state_machine: 'EVM-56',
  host_address: ISMPHosts['EVM-56'],
  consensus_state_id: 'BSC0',
 },
 'EVM-10': {
  rpc_url: process.env.OPTIMISM_RPC_URL!,
  state_machine: 'EVM-10',
  host_address: ISMPHosts['EVM-10'],
  consensus_state_id: 'ETH0',
 },
 'EVM-42161': {
  rpc_url: process.env.ARBITRUM_RPC_URL || '',
  state_machine: 'EVM-42161',
  host_address: ISMPHosts['EVM-42161'],
  consensus_state_id: 'ETH0',
 },
 'EVM-100': {
  rpc_url: process.env.GNOSIS_RPC_URL || '',
  state_machine: 'EVM-100',
  host_address: ISMPHosts['EVM-100'],
  consensus_state_id: 'ETH0',
 },
 'EVM-1868': {
  rpc_url: process.env.SONEMIUM_RPC_URL || '',
  state_machine: 'EVM-1868',
  host_address: ISMPHosts['EVM-1868'],
  consensus_state_id: 'ETH0',
 },
};

export const SUBSTRATE_CHAINS: ChainConfig = {
 'POLKADOT-2030': {
  rpc_url: process.env.BIFROST_RPC_URL || '',
  state_machine: 'POLKADOT-2030',
  consensus_state_id: process.env.BIFROST_CONSENSUS_STATE_ID || 'PARA',
  hash_algo: 'Keccak',
 },
 'POLKADOT-3367': {
  rpc_url: process.env.HYPERBRIDGE_RPC_URL || '',
  state_machine: 'POLKADOT-3367',
  consensus_state_id: process.env.HYPERBRIDGE_CONSENSUS_STATE_ID || 'PARA',
  hash_algo: 'Keccak',
 },
};
