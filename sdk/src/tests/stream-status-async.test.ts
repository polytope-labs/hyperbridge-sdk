import { jest, expect, beforeEach, afterEach } from '@jest/globals';
import { HyperIndexerClient } from '..';
import { RequestStatus, BlockMetadata } from '..';

describe('statusStream', () => {
 let client: HyperIndexerClient;
 const VALID_HASH = '0x1234567890abcdef';

 const mockMetadata: BlockMetadata = {
  blockHash: '0xabc123',
  blockHeight: 100,
  blockNumber: 100,
  timestamp: BigInt(1234567890),
 };

 const mockResponses = [
  {
   requests: {
    nodes: [
     {
      status: RequestStatus.SOURCE_FINALIZED,
      statusMetadata: [
       {
        blockHash: mockMetadata.blockHash,
        blockHeight: '100',
        blockNumber: '100',
        timestamp: '1234567890',
       },
      ],
     },
    ],
   },
  },
  {
   requests: {
    nodes: [
     {
      status: RequestStatus.HYPERBRIDGE_FINALIZED,
      statusMetadata: [
       {
        blockHash: '0xdef456',
        blockHeight: '101',
        blockNumber: '101',
        timestamp: '1234567891',
       },
      ],
     },
    ],
   },
  },
  {
   requests: {
    nodes: [
     {
      status: RequestStatus.DELIVERED,
      statusMetadata: [
       {
        blockHash: '0xdef456',
        blockHeight: '101',
        blockNumber: '101',
        timestamp: '1234567891',
       },
      ],
     },
    ],
   },
  },
 ];

 beforeEach(() => {
  client = new HyperIndexerClient();
  client['pollInterval'] = 100;
  const mockRequest = jest.spyOn(client['client'], 'request');
  mockResponses.forEach((response, index) => {
   mockRequest.mockResolvedValueOnce(response);
  });
 });

 afterEach(() => {
  jest.clearAllMocks();
  // Clear any pending timers
  jest.useRealTimers();
 });

 jest.setTimeout(60000);

 it('streams status updates with metadata', async () => {
  const updates = [];
  for await (const update of client.statusStream(VALID_HASH)) {
   updates.push(update);
  }

  expect(updates).toEqual([
   {
    status: RequestStatus.SOURCE_FINALIZED,
    metadata: mockMetadata,
   },
   {
    status: RequestStatus.DELIVERED,
    metadata: {
     blockHash: '0xdef456',
     blockHeight: 101,
     blockNumber: 101,
     timestamp: BigInt(1234567891),
    },
   },
  ]);
 });

 it('handles network interruptions with retry', async () => {
  jest
   .spyOn(client['client'], 'request')
   .mockRejectedValueOnce(new Error('Network error'))
   .mockResolvedValueOnce(mockResponses[0])
   .mockResolvedValueOnce(mockResponses[1]);

  const updates = [];
  for await (const update of client.statusStream(VALID_HASH)) {
   updates.push(update);
  }
  expect(updates.length).toBe(2);
 });

 it('stops streaming at terminal status', async () => {
  const updates = [];
  for await (const update of client.statusStream(VALID_HASH)) {
   updates.push(update);
  }
  expect(updates[updates.length - 1].status).toBe(RequestStatus.DELIVERED);
 });

 it('skips duplicate status updates', async () => {
  const duplicateResponses = [
   mockResponses[0],
   mockResponses[0],
   mockResponses[1],
  ];
  const mockRequest = jest.spyOn(client['client'], 'request');
  duplicateResponses.forEach((response) => {
   mockRequest.mockResolvedValueOnce(response);
  });

  const updates = [];
  for await (const update of client.statusStream(VALID_HASH)) {
   updates.push(update);
  }
  expect(updates.length).toBe(2);
 });
});
