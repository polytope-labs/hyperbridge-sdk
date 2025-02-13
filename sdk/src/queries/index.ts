import { gql } from 'graphql-request';

export const REQUEST_STATUS = `
  query GetRequestStatus($hash: String!) {
    requests(
      filter: {
        or: [
          { commitment: { equalTo: $hash } }
          { hyperbridgeTransactionHash: { equalTo: $hash } }
          { sourceTransactionHash: { equalTo: $hash } }
          { destinationTransactionHash: { equalTo: $hash } }
        ]
      }
    ) {
      nodes {
        status
        statusMetadata {
          nodes {
            blockHash
            blockNumber
            timestamp
            chain
          }
        }
      }
    }
  }
`;

export const STATE_MACHINE_UPDATES = `
  query GetStateMachineUpdates($statemachineId: String!, $height: Int!, $chain: String!) {
    stateMachineUpdateEvents(
      filter: {
        and: [
          { stateMachineId: { equalTo: $statemachineId } }
          { height: { greaterThanOrEqualTo: $height } }
          { chain: { equalTo: $chain } }
        ]
      }
    ) {
      nodes {
        height
        chain
        blockHash
        blockNumber
        transactionHash
        transactionIndex
        stateMachineId
        createdAt
      }
    }
  }
`;
