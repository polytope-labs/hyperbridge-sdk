import { jest, expect, beforeEach, afterEach } from '@jest/globals';
import { HyperClientStatus, HyperIndexerClient } from '..';
import { RequestStatus, BlockMetadata } from '..';

export interface TestBlockMetadata {
 blockHash: string;
 blockNumber: number;
 timestamp: string;
 chain: string;
}


describe('createStatusStream', () => {
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
      status: HyperClientStatus.SOURCE_FINALIZED,
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
      status: HyperClientStatus.HYPERBRIDGE_FINALIZED,
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
      status: RequestStatus.HYPERBRIDGE_DELIVERED,
      statusMetadata: {
       nodes: [
        {
         blockHash: '0xdef789',
         blockNumber: '102',
         timestamp: '987654321',
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
    status: HyperClientStatus.SOURCE_FINALIZED,
    metadata: mockMetadata,
   },
   {
    status: RequestStatus.HYPERBRIDGE_DELIVERED,
    metadata: {
     blockHash: '0xdef456',
     blockNumber: 101,
     timestamp: '1234567891',
     chain: '11155111',
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
   status: HyperClientStatus.SOURCE_FINALIZED,
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

  expect(updates[updates.length - 1].status).toBe(RequestStatus.HYPERBRIDGE_DELIVERED);
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
