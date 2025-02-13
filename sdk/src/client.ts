import { GraphQLClient } from 'graphql-request';
import { REQUEST_STATUS, STATE_MACHINE_UPDATES } from './queries';
import {
 RequestStatus,
 StatusResponse,
 StateMachineUpdate,
 BlockMetadata,
 RequestResponse,
 StateMachineResponse,
} from './types';

export class HyperClient {
 private client: GraphQLClient;
 private pollInterval: number = 1000;

 constructor() {
  this.client = new GraphQLClient('http://localhost:3000/graphql');
 }

 async queryStatus(hash: string): Promise<StatusResponse> {
  const response = await this.client.request<RequestResponse>(REQUEST_STATUS, {
   hash,
  });
  const request = response.requests.nodes[0];

  if (!request) {
   throw new Error(`No request found for hash: ${hash}`);
  }

  const metadata = this.extractBlockMetadata(request.statusMetadata[0]);
  return {
   status: request.status as RequestStatus,
   metadata,
  };
 }

 async *statusStream(hash: string) {
  let lastStatus: RequestStatus | null = null;

  while (true) {
   const { status, metadata } = await this.queryStatus(hash);

   if (status !== lastStatus) {
    yield { status, metadata };
    lastStatus = status;
   }

   if (this.isTerminalStatus(status)) {
    break;
   }

   await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
  }
 }

 async *stateMachineUpdateStream(
  statemachineId: string,
  height: number,
  chain: string
 ): AsyncGenerator<StateMachineUpdate> {
  let lastHeight = height;

  while (true) {
   const response = await this.client.request<StateMachineResponse>(
    STATE_MACHINE_UPDATES,
    {
     statemachineId,
     height: lastHeight,
     chain,
    }
   );

   const updates = response.stateMachineUpdateEvents.nodes;

   for (const update of updates) {
    if (update.height >= lastHeight) {
     yield update;
     lastHeight = update.height + 1;
    }
   }

   await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
  }
 }

 private isTerminalStatus(status: RequestStatus): boolean {
  return (
   status === RequestStatus.DELIVERED || status === RequestStatus.TIMED_OUT
  );
 }

 private extractBlockMetadata(data: any): BlockMetadata {
  return {
   blockHash: data.blockHash,
   blockHeight: parseInt(data.blockHeight),
   blockNumber: parseInt(data.blockNumber),
   timestamp: BigInt(data.timestamp),
  };
 }
}
