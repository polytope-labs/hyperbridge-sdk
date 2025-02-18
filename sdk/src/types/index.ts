export interface ClientConfig {
 pollInterval?: number;
}

export interface RetryConfig {
 maxRetries: number;
 backoffMs: number;
}
export enum RequestStatus {
 SOURCE = 'SOURCE',
 HYPERBRIDGE_DELIVERED = 'HYPERBRIDGE_DELIVERED',
 DESTINATION = 'DESTINATION',
 TIMED_OUT = 'TIMED_OUT',
 HYPERBRIDGE_TIMED_OUT = 'HYPERBRIDGE_TIMED_OUT',
}

export enum HyperClientStatus {
 PENDING = 'SOURCE',
 SOURCE_FINALIZED = 'SOURCE_FINALIZED',
 HYPERBRIDGE_FINALIZED = 'HYPERBRIDGE_FINALIZED',
 HYPERBRIDGE_DELIVERED = 'HYPERBRIDGE_DELIVERED',
 DESTINATION = 'DESTINATION',
 TIMED_OUT = 'TIMED_OUT',
 HYPERBRIDGE_TIMED_OUT = 'HYPERBRIDGE_TIMED_OUT',
}

export interface BlockMetadata {
 blockHash: string;
 blockNumber: number;
 timestamp: bigint;
 chain: string;
 transactionHash: string;
 status: HyperClientStatus | RequestStatus;
 callData?: string;
}

export interface StatusResponse {
 status: RequestStatus | HyperClientStatus;
 metadata: Partial<BlockMetadata>;
}

export interface StateMachineUpdate {
 height: number;
 chain: string;
 blockHash: string;
 blockNumber: number;
 transactionHash: string;
 transactionIndex: number;
 stateMachineId: string;
 createdAt: string;
}

export interface RequestResponse {
 requests: {
  nodes: Array<{
   source: string;
   dest: string;
   to: string;
   from: string;
   nonce: bigint;
   body: string;
   timeoutTimestamp: bigint;
   statusMetadata: {
    nodes: Array<{
     blockHash: string;
     blockNumber: string;
     timestamp: string;
     chain: string;
     status: string;
     transactionHash: string;
     callData?: string;
    }>;
   };
  }>;
 };
}

export interface StateMachineResponse {
 stateMachineUpdateEvents: {
  nodes: StateMachineUpdate[];
 };
}
