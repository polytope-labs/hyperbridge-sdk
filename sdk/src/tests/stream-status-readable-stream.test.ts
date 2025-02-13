import { jest, expect, beforeEach, afterEach } from '@jest/globals';
import { HyperIndexerClient } from '..';
import { RequestStatus, BlockMetadata } from '..';

describe('createStatusStream', () => {
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
        blockHash: '0xdef789',
        blockHeight: '102',
        blockNumber: '102',
        timestamp: '987654321',
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
  mockResponses.forEach((response) => {
   mockRequest.mockResolvedValueOnce(response);
  });
 });

 afterEach(() => {
  jest.clearAllMocks();
  // Clear any pending timers
  jest.useRealTimers();
 });

 jest.setTimeout(60000);

 it('emits status updates with metadata', async () => {
  const stream = client.createStatusStream(VALID_HASH);
  const reader = stream.getReader();

  const updates = [];
  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   updates.push(value);
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

 it('handles network errors with retry', async () => {
  jest
   .spyOn(client['client'], 'request')
   .mockRejectedValueOnce(new Error('Network error'))
   .mockResolvedValueOnce(mockResponses[0])
   .mockResolvedValueOnce(mockResponses[1]);

  const stream = client.createStatusStream(VALID_HASH);
  const reader = stream.getReader();

  const { value } = await reader.read();
  expect(value).toEqual({
   status: RequestStatus.SOURCE_FINALIZED,
   metadata: mockMetadata,
  });
 });

 it('closes stream at terminal status', async () => {
  const stream = client.createStatusStream(VALID_HASH);
  const reader = stream.getReader();

  const updates = [];
  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   updates.push(value);
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

  const stream = client.createStatusStream(VALID_HASH);
  const reader = stream.getReader();

  const updates = [];
  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   updates.push(value);
  }

  expect(updates.length).toBe(2);
 });
});
