import { jest, expect, beforeEach, afterEach } from '@jest/globals';
import { HyperIndexerClient } from '..';
import { RequestStatus, BlockMetadata } from '..';

export interface TestBlockMetadata {
 blockHash: string;
 blockNumber: number;
 timestamp: string;
 chain: string;
}


describe('statusStream', () => {
 let client: HyperIndexerClient;
 const VALID_HASH = '0x1234567890abcdef';

 const mockMetadata: TestBlockMetadata = {
  blockHash: '0xabc123',
  blockNumber: 100,
  timestamp: '1234567890',
  chain: '11155111',
 };

 const mockResponses = [
  {
   requests: {
    nodes: [
     {
      status: RequestStatus.SOURCE_FINALIZED,
      statusMetadata: {
       nodes: [
        {
         blockHash: mockMetadata.blockHash,
         blockNumber: '100',
         timestamp: '1234567890',
         chain: '11155111',
        },
       ],
      },
     },
    ],
   },
  },
  {
   requests: {
    nodes: [
     {
      status: RequestStatus.HYPERBRIDGE_FINALIZED,
      statusMetadata: {
       nodes: [
        {
         blockHash: '0xdef456',
         blockNumber: '101',
         timestamp: '1234567891',
         chain: '11155111',
        },
       ],
      },
     },
    ],
   },
  },
  {
   requests: {
    nodes: [
     {
      status: RequestStatus.DELIVERED,
      statusMetadata: {
       nodes: [
        {
         blockHash: '0xdef456',
         blockNumber: '101',
         timestamp: '1234567891',
         chain: '11155111',
        },
       ],
      },
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
     blockNumber: 101,
     timestamp: '1234567891',
     chain: '11155111',
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
