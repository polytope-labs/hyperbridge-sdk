export interface ClientConfig {
 pollInterval?: number;
}

export interface RetryConfig {
 maxRetries: number;
 backoffMs: number;
}
export enum RequestStatus {
 PENDING = 'SOURCE',
 SOURCE_FINALIZED = 'SOURCE_FINALIZED',
 HYPERBRIDGE_VERIFIED = 'HYPERBRIDGE_DELIVERED',
 HYPERBRIDGE_FINALIZED = 'HYPERBRIDGE_FINALIZED',
 DELIVERED = 'DESTINATION',
 TIMED_OUT = 'TIMED_OUT',
}

export interface BlockMetadata {
 blockHash: string;
 blockHeight: number;
 blockNumber: number;
 timestamp: bigint;
}

export interface StatusResponse {
 status: RequestStatus;
 metadata: BlockMetadata;
}

export interface StateMachineUpdate {
 height: number;
 chain: string;
 blockHash: string;
 blockNumber: number;
 transactionHash: string;
 transactionIndex: number;
 stateMachineId: string;
 createdAt: Date;
}

export interface RequestResponse {
 requests: {
  nodes: Array<{
   status: RequestStatus;
   timeoutTimestamp: string;
   statusMetadata: Array<{
    blockHash: string;
    blockNumber: string;
    timestamp: string;
   }>;
  }>;
 };
}

export interface StateMachineResponse {
 stateMachineUpdateEvents: {
  nodes: Array<{
   height: number;
   chain: string;
   blockHash: string;
   blockNumber: number;
   transactionHash: string;
   transactionIndex: number;
   stateMachineId: string;
   createdAt: Date;
  }>;
 };
}
