import 'log-timestamp';
import dotenv from 'dotenv';

import {
 HyperClient,
 IPostRequest,
 MessageStatusWithMeta,
} from '@polytope-labs/hyperclient';
import {
 createPublicClient,
 createWalletClient,
 decodeFunctionData,
 formatEther,
 fromHex,
 getContract,
 Hash,
 http,
 parseAbi,
 parseEventLogs,
 toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet, baseSepolia, bifrost, bsc } from 'viem/chains';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Account } from '@ethereumjs/util';

dotenv.config();

import ERC6160 from './abis/erc6160';
import PING_MODULE from './abis/pingModule';
import EVM_HOST from './abis/evmHost';
import HANDLER from './abis/handler';
import { GraphQLClient } from 'graphql-request';
import { REQUEST } from '../../queries';
import {
 BlockMetadata,
 HyperClientStatus,
 IsmpRequest,
 RequestCommitment,
 RequestStatus,
} from '../../types';
import {
 HYPERBRIDGE_TESTNET,
 SUBSTRATE_CHAINS,
} from '../../hyperclient/constants';
import { SubmittableExtrinsic } from '@polkadot/api/types';

const PING_MODULE_ADDRESS = '0xFE9f23F0F2fE83b8B9576d3FC94e9a7458DdDD35';

/*
  Using a viem client, dispatches an onchain transaction to the ping module.
  The ping module contract, dispatches an ISMP request to Hyperbridge.
  Then tracks the resulting ISMP request using Hyperclient.
*/
export async function dispatchPostRequest(): Promise<
 | {
    commitment: string;
    request: IPostRequest;
   }
 | undefined
> {
 const {
  bscTestnetClient,
  bscFeeToken,
  BSC,
  BASE,
  account,
  tokenFaucet,
  baseSepoliaHandler,
  bscHandler,
  bscPing,
  baseSepoliaClient,
  baseSepoliaIsmpHost,
 } = await setUp();
 const blockNumber = await bscTestnetClient.getBlockNumber();
 console.log('Latest block number: ', blockNumber);

 let balance = await bscFeeToken.read.balanceOf([account.address as any]);
 console.log('FeeToken balance: $', formatEther(balance));

 // Get fee tokens from faucet
 if (balance === BigInt(0)) {
  const hash = await tokenFaucet.write.drip([bscFeeToken.address]);
  await bscTestnetClient.waitForTransactionReceipt({
   hash,
   confirmations: 1,
  });
  balance = await bscFeeToken.read.balanceOf([account.address as any]);

  console.log('New FeeToken balance: $', formatEther(balance));
 }

 const allowance = await bscFeeToken.read.allowance([
  account.address!,
  PING_MODULE_ADDRESS,
 ]);

 if (allowance === BigInt(0)) {
  console.log('Setting allowance .. ');
  // set allowance to type(uint256).max
  const hash = await bscFeeToken.write.approve([
   PING_MODULE_ADDRESS,
   fromHex(
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'bigint'
   ),
  ]);
  await bscTestnetClient.waitForTransactionReceipt({
   hash,
   confirmations: 1,
  });
 }

 console.log('Setting up hyperclient');

 const HyperbridgeConfig = {
  rpc_url: 'wss://hyperbridge-paseo-rpc.blockops.network',
  state_machine: 'KUSAMA-4009',
  consensus_state_id: 'PARA',
 };

 const hyperclient = await HyperClient.init({
  source: BSC,
  dest: BASE,
  // dest: OP,
  hyperbridge: HyperbridgeConfig,
  tracing: false,
 });

 console.log('\n\nSending Post Request\n\n');
 const hash = await bscPing.write.ping([
  {
   dest: await baseSepoliaIsmpHost.read.host(),
   count: BigInt(1),
   fee: BigInt(0),
   module: PING_MODULE_ADDRESS,
   timeout: BigInt(60 * 60),
  },
 ]);

 const receipt = await bscTestnetClient.waitForTransactionReceipt({
  hash,
  confirmations: 1,
 });

 console.log(
  `Transaction reciept: ${bscTestnet.blockExplorers.default.url}/tx/${hash}`
 );
 console.log('Block: ', receipt.blockNumber);

 // parse EvmHost PostRequestEvent emitted in the transcation logs
 const event = parseEventLogs({ abi: EVM_HOST.ABI, logs: receipt.logs })[0];

 if (event.eventName !== 'PostRequestEvent') {
  throw new Error('Unexpected Event type');
 }

 const request = event.args;

 console.log({ request });

 const status = await hyperclient.query_post_request_status(request);

 console.log('Request status: ', status);

 let commitment: string;

 const stream = await hyperclient.post_request_status_stream(request, {
  Dispatched: receipt.blockNumber,
 });

 for await (const item of stream) {
  let status: MessageStatusWithMeta;
  if (item instanceof Map) {
   status = Object.fromEntries(
    (item as any).entries()
   ) as MessageStatusWithMeta;
  } else {
   status = item;
  }

  console.log({ status });

  switch (status.kind) {
   case 'SourceFinalized': {
    console.log(
     `Status ${status.kind}, Transaction: https://gargantua.statescan.io/#/extrinsics/${status.transaction_hash}`
    );
    const client = new GraphQLClient(process.env.GRAPHQL_URL!);
    const response = await client.request<RequestCommitment>(REQUEST, {
     nonce: request.nonce,
     source: request.source,
     dest: request.dest,
    });

    commitment = response.requests.nodes[0].commitment;

    return { commitment, request };
   }
  }
 }
}

async function setUp() {
 const account = privateKeyToAccount(process.env.PRIVATE_KEY as any);

 const bscWalletClient = createWalletClient({
  chain: bscTestnet,
  account,
  transport: http(),
 });

 const baseWalletClient = createWalletClient({
  chain: baseSepolia,
  account,
  transport: http(),
 });

 const bscTestnetClient = createPublicClient({
  chain: bscTestnet,
  transport: http(),
 });

 const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
 });

 const bscPing = getContract({
  address: PING_MODULE_ADDRESS,
  abi: PING_MODULE.ABI,
  client: { public: bscTestnetClient, wallet: bscWalletClient },
 });

 const bscIsmpHostAddress = await bscPing.read.host();

 const bscIsmpHost = getContract({
  address: bscIsmpHostAddress,
  abi: EVM_HOST.ABI,
  client: bscTestnetClient,
 });

 const bscHostParams = await bscIsmpHost.read.hostParams();

 const bscHandler = getContract({
  address: bscHostParams.handler,
  abi: HANDLER.ABI,
  client: { public: bscTestnetClient, wallet: bscWalletClient },
 });

 const bscFeeToken = getContract({
  address: bscHostParams.feeToken,
  abi: ERC6160.ABI,
  client: { public: bscTestnetClient, wallet: bscWalletClient },
 });

 const baseSepoliaPing = getContract({
  address: PING_MODULE_ADDRESS,
  abi: PING_MODULE.ABI,
  client: baseSepoliaClient,
 });

 const baseSepoliaIsmpHostAddress = await baseSepoliaPing.read.host();

 const baseSepoliaIsmpHost = getContract({
  address: baseSepoliaIsmpHostAddress,
  abi: EVM_HOST.ABI,
  client: baseSepoliaClient,
 });

 const baseSepoliaHostParams = await baseSepoliaIsmpHost.read.hostParams();

 const baseSepoliaHandler = getContract({
  address: baseSepoliaHostParams.handler,
  abi: HANDLER.ABI,
  client: { public: baseSepoliaClient, wallet: baseWalletClient },
 });

 const tokenFaucet = getContract({
  address: '0x17d8cc0859fbA942A7af243c3EBB69AbBfe0a320',
  abi: parseAbi(['function drip(address token) public']),
  client: { public: bscTestnetClient, wallet: bscWalletClient },
 });

 const BSC = {
  rpc_url: process.env.BSC_URL!,
  consensus_state_id: 'BSC0',
  host_address: bscIsmpHostAddress,
  state_machine: await bscIsmpHost.read.host(),
 };

 const BASE = {
  rpc_url: process.env.BASE_URL!,
  consensus_state_id: 'ETH0',
  host_address: baseSepoliaIsmpHostAddress,
  state_machine: await baseSepoliaIsmpHost.read.host(),
 };

 return {
  bscTestnetClient,
  bscFeeToken,
  account,
  tokenFaucet,
  BSC,
  BASE,
  baseSepoliaHandler,
  bscHandler,
  bscPing,
  baseSepoliaClient,
  baseSepoliaIsmpHost,
 };
}
