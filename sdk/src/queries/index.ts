import { gql } from 'graphql-request';

export const REQUEST_STATUS = gql`
 query GetRequestStatus($hash: String!) {
  requests(
   filter: {
    or: [
     { commitment: { equalTo: $hash } }
     { hyperbridgeTransactionHash: { equalTo: $hash } }
     { sourceTransactionHash: { equalTo: $hash } }
     { destinationTransactionHash: { equalTo: $hash } }
     { hyperbridgeTimeoutTransactionHash: { equalTo: $hash } }
     { destinationTimeoutTransactionHash: { equalTo: $hash } }
    ]
   }
  ) {
   nodes {
    status
    timeoutTimestamp
    statusMetadata {
     blockHash
     blockNumber
     timestamp
    }
   }
  }
 }
`;

export const STATE_MACHINE_UPDATES = gql`
 query GetStateMachineUpdates(
  $statemachineId: String!
  $height: Int!
  $chain: String!
 ) {
  stateMachineUpdateEvents(
   filter: {
    stateMachineId: { equalTo: $statemachineId }
    height: { greaterThanOrEqualTo: $height }
    chain: { equalTo: $chain }
   }
   orderBy: HEIGHT_ASC
  ) {
   nodes {
    height
    chain
    blockHash
    blockNumber
    transactionHash
   }
  }
 }
`;
