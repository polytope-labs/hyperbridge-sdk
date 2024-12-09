import { SubstrateDatasourceKind, SubstrateHandlerKind, SubstrateProject } from '@subql/types';

const project: SubstrateProject = {
  specVersion: '1.0.0',
  version: '0.0.1',
  name: 'hyperbridge-parachain',
  description: 'Hyperbridge ParaChain Indexer',
  runner: {
    node: {
      name: '@subql/node',
      version: '>=4.0.0',
    },
    query: {
      name: '@subql/query',
      version: '*',
    },
  },
  schema: {
    file: './schema.graphql',
  },
  network: {
    chainId: '0x5388faf792c5232566d21493929b32c1f20a9c2b03e95615eefec2aa26d64b73',
    endpoint: [
      'wss://hyperbridge-paseo-rpc.blockops.network',
    ],
    chaintypes: {
      file: './dist/hyperbridge-chaintypes.js',
    },
  },
  dataSources: [
    {
      kind: SubstrateDatasourceKind.Runtime,
      startBlock: 695,
      mapping: {
        file: './dist/index.js',
        handlers: [
          {
            handler: 'handleIsmpStateMachineUpdatedEvent',
            kind: SubstrateHandlerKind.Event,
            filter: {
              module: 'ismp',
              method: 'StateMachineUpdated',
            },
          },
          {
            handler: 'handleHyperbridgeRequestEvent',
            kind: SubstrateHandlerKind.Event,
            filter: {
              module: 'ismp',
              method: 'Request',
            },
          },
          {
            handler: 'handleHyperbridgeResponseEvent',
            kind: SubstrateHandlerKind.Event,
            filter: {
              module: 'ismp',
              method: 'Response',
            },
          },
          {
            handler: 'handleHyperbridgePostRequestTimeoutHandledEvent',
            kind: SubstrateHandlerKind.Event,
            filter: {
              module: 'ismp',
              method: 'PostRequestTimeoutHandled',
            },
          },
          {
            handler: 'handleHyperbridgePostResponseTimeoutHandledEvent',
            kind: SubstrateHandlerKind.Event,
            filter: {
              module: 'ismp',
              method: 'PostResponseTimeoutHandled',
            },
          },
        ],
      },
    },
  ],
  repository: 'https://github.com/polytope-labs/hyperbridge',
};

export default project;