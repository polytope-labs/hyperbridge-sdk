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

export const STATE_MACHINE_UPDATES_BY_HEIGHT = `
query StateMachineUpdatesByHeight($statemachineId: String!, $height: Int!, $chain: String!) {
	stateMachineUpdateEvents(
		filter: {
			and: [
				{ stateMachineId: { equalTo: $statemachineId } }
				{ height: { greaterThanOrEqualTo: $height } }
				{ chain: { equalTo: $chain } }
			]
		}
		orderBy: HEIGHT_ASC
		first: 1
	) {
    nodes {
      height
      stateMachineId
      chain
      blockHash
      blockNumber
      transactionHash
    }
  }
}
`

export const STATE_MACHINE_UPDATES_BY_TIMESTAMP = `
query StateMachineUpdatesByTimestamp($statemachineId: String!, $timestamp: BigFloat!) {
	stateMachineUpdateEvents(
		filter: {
			and: [
				{ stateMachineId: { equalTo: $statemachineId } }
				{ commitmentTimestamp: { greaterThanOrEqualTo: $timestamp } }
			]
		}
		orderBy: COMMITMENT_TIMESTAMP_ASC
		first: 1
	) {
    nodes {
        height
        chain
        blockHash
        blockNumber
        transactionHash
        commitmentTimestamp
        transactionIndex
        stateMachineId
        createdAt
      }
    }
  }
`
