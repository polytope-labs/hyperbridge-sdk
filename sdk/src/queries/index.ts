export const REQUEST_STATUS = `
  query RequestStatus($hash: String!) {
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
        timeoutTimestamp
        source
        dest
        to
        from
        nonce
        body
        statusMetadata {
          nodes {
            blockHash
            blockNumber
            timestamp
            chain
            status
            transactionHash
          }
        }
      }
    }
  }
`

export const STATE_MACHINE_UPDATES = `
   query StateMachineUpdates($statemachineId: String!, $height: Int!, $chain: String!) {
    stateMachineUpdateEvents(
      filter: {
        and: [
          { stateMachineId: { equalTo: $statemachineId } }
          { height: { greaterThanOrEqualTo: $height } }
        ]
      }
      orderBy: CREATED_AT_DESC
      first: 1
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
`
