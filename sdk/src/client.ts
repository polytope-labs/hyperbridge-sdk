import { GraphQLClient } from 'graphql-request';
import { REQUEST_STATUS, STATE_MACHINE_UPDATES } from './queries';
import {
 RequestStatus,
 StatusResponse,
 StateMachineUpdate,
 BlockMetadata,
 RequestResponse,
 StateMachineResponse,
 ClientConfig,
 RetryConfig,
} from './types';

/**
 * HyperIndexerClient provides methods to interact with the Hyperbridge indexer
 */
export class HyperIndexerClient {
 private client: GraphQLClient;
 private pollInterval: number = 1000;
 private defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  backoffMs: 1000,
 };

 /**
  * Creates a new HyperIndexerClient instance
  */
 constructor(config?: ClientConfig) {
  this.client = new GraphQLClient('http://localhost:3000/graphql');
  this.pollInterval = config?.pollInterval || 5000;
 }

 /**
  * Query the latest status of a request by any of its associated hashes
  * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
  * @returns Latest status and block metadata of the request
  * @throws Error if request is not found
  */
 async queryStatus(hash: string): Promise<StatusResponse> {
  const response = await this.client.request<RequestResponse>(REQUEST_STATUS, {
   hash,
  });
  const request = response.requests.nodes[0];

  if (!request) {
   throw new Error(`No request found for hash: ${hash}`);
  }

  const metadata = this.extractBlockMetadata(request.statusMetadata.nodes[0]);
  return {
   status: request.status as RequestStatus,
   metadata,
  };
 }

 /**
  * Stream status updates using async generator pattern
  * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
  * @yields Status updates as they occur until a terminal state is reached
  */
 async *statusStream(hash: string) {
  let lastStatus: RequestStatus | null = null;

  while (true) {
   const { status, metadata } = await this.withRetry(() =>
    this.queryStatus(hash)
   );

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

 /**
  * Stream state machine updates using async generator pattern
  * @param statemachineId - ID of the state machine to monitor
  * @param height - Starting block height
  * @param chain - Chain identifier
  * @yields State machine updates as they occur
  */
 async *stateMachineUpdateStream(
  statemachineId: string,
  height: number,
  chain: string
 ): AsyncGenerator<StateMachineUpdate> {
  let lastHeight = height;

  while (true) {
   const response = await this.withRetry(() =>
    this.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES, {
     statemachineId,
     height: lastHeight,
     chain,
    })
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

 /**
  * Create a ReadableStream of status updates
  * @param hash - Can be commitment, hyperbridge tx hash, source tx hash, destination tx hash, or timeout tx hash
  * @returns ReadableStream that emits status updates until a terminal state is reached
  */
 createStatusStream(hash: string): ReadableStream<StatusResponse> {
  const self = this;
  return new ReadableStream({
   async start(controller) {
    let lastStatus: RequestStatus | null = null;
    while (true) {
     try {
      const { status, metadata } = await self.withRetry(() =>
       self.queryStatus(hash)
      );

      if (status !== lastStatus) {
       controller.enqueue({ status, metadata });
       lastStatus = status;
      }

      if (self.isTerminalStatus(status)) {
       controller.close();
       break;
      }

      await new Promise((resolve) => setTimeout(resolve, self.pollInterval));
     } catch (error) {
      controller.error(error);
     }
    }
   },
  });
 }

 /**
  * Create a ReadableStream of state machine updates
  * @param statemachineId - ID of the state machine to monitor
  * @param height - Starting block height
  * @param chain - Chain identifier
  * @returns ReadableStream that emits state machine updates
  */
 createStateMachineUpdateStream(
  statemachineId: string,
  height: number,
  chain: string
 ): ReadableStream<StateMachineUpdate> {
  const self = this;
  return new ReadableStream({
   async start(controller) {
    let lastHeight = height;
    while (true) {
     try {
      const response = await self.withRetry(() =>
       self.client.request<StateMachineResponse>(STATE_MACHINE_UPDATES, {
        statemachineId,
        height: lastHeight,
        chain,
       })
      );

      const updates = response.stateMachineUpdateEvents.nodes;
      for (const update of updates) {
       if (update.height >= lastHeight) {
        controller.enqueue(update);
        lastHeight = update.height + 1;
       }
      }

      await new Promise((resolve) => setTimeout(resolve, self.pollInterval));
     } catch (error) {
      controller.error(error);
     }
    }
   },
  });
 }

 /**
  * Check if a status represents a terminal state
  * @param status - Request status to check
  * @returns true if status is terminal (DELIVERED or TIMED_OUT)
  */
 private isTerminalStatus(status: RequestStatus): boolean {
  return (
   status === RequestStatus.TIMED_OUT ||
   status === RequestStatus.HYPERBRIDGE_TIMED_OUT ||
   status === RequestStatus.DELIVERED
  );
 }

 /**
  * Extract block metadata from raw response data
  * @param data - Raw block metadata from GraphQL response
  * @returns Formatted block metadata
  */
 private extractBlockMetadata(data: any): BlockMetadata {
  return {
   blockHash: data.blockHash,
   blockNumber: parseInt(data.blockNumber),
   timestamp: BigInt(data.timestamp),
   chain: data.chain,
  };
 }

 /**
  * Executes an async operation with exponential backoff retry
  * @param operation - Async function to execute
  * @param retryConfig - Optional retry configuration
  * @returns Result of the operation
  * @throws Last encountered error after all retries are exhausted
  *
  * @example
  * const result = await this.withRetry(() => this.queryStatus(hash));
  */
 private async withRetry<T>(
  operation: () => Promise<T>,
  retryConfig: RetryConfig = this.defaultRetryConfig
 ): Promise<T> {
  let lastError;
  for (let i = 0; i < retryConfig.maxRetries; i++) {
   try {
    return await operation();
   } catch (error) {
    lastError = error;
    await new Promise((resolve) =>
     setTimeout(resolve, retryConfig.backoffMs * Math.pow(2, i))
    );
   }
  }
  throw lastError;
 }
}
