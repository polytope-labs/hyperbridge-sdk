import { jest, expect, beforeEach,afterEach } from '@jest/globals';
import { HyperIndexerClient } from '..';
import { RequestStatus, BlockMetadata } from '..';

describe('queryStatus', () => {
 let client: HyperIndexerClient;
 const VALID_HASH = '0x1234567890abcdef';
 const INVALID_HASH = '0xinvalid';
 const TIMED_OUT_HASH = '0xdeadbeef';

 const mockMetadata: BlockMetadata = {
  blockHash: '0xabc123',
  blockHeight: 100,
  blockNumber: 100,
  timestamp: BigInt(1234567890),
 };

 beforeEach(() => {
  client = new HyperIndexerClient();
 });

 afterEach(() => {
  jest.clearAllMocks();
  // Clear any pending timers
  jest.useRealTimers();
 });

 jest.setTimeout(60000);

 it('returns correct status and metadata for valid hash', async () => {
  jest.spyOn(client['client'], 'request').mockResolvedValue({
   requests: {
    nodes: [
     {
      status: RequestStatus.DELIVERED,
      statusMetadata: [
       {
        blockHash: mockMetadata.blockHash,
        blockHeight: mockMetadata.blockHeight.toString(),
        blockNumber: mockMetadata.blockNumber.toString(),
        timestamp: mockMetadata.timestamp.toString(),
       },
      ],
     },
    ],
   },
  });

  const result = await client.queryStatus(VALID_HASH);
  expect(result.status).toBe(RequestStatus.DELIVERED);
  expect(result.metadata).toEqual(mockMetadata);
 });

 it('throws error for invalid hash format', async () => {
  jest
   .spyOn(client['client'], 'request')
   .mockRejectedValue(new Error('Invalid hash format'));

  await expect(client.queryStatus(INVALID_HASH)).rejects.toThrow(
   'Invalid hash format'
  );
 });

 it('throws error when request not found', async () => {
  jest.spyOn(client['client'], 'request').mockResolvedValue({
   requests: { nodes: [] },
  });

  await expect(client.queryStatus('0x0000000000000000')).rejects.toThrow(
   'No request found'
  );
 });

 it('handles timed out requests', async () => {
  jest.spyOn(client['client'], 'request').mockResolvedValue({
   requests: {
    nodes: [
     {
      status: RequestStatus.TIMED_OUT,
      statusMetadata: [
       {
        blockHash: mockMetadata.blockHash,
        blockHeight: mockMetadata.blockHeight.toString(),
        blockNumber: mockMetadata.blockNumber.toString(),
        timestamp: mockMetadata.timestamp.toString(),
       },
      ],
     },
    ],
   },
  });

  const result = await client.queryStatus(TIMED_OUT_HASH);
  expect(result.status).toBe(RequestStatus.TIMED_OUT);
  expect(result.metadata).toEqual(mockMetadata);
 });

 it('handles malformed metadata response', async () => {
  jest.spyOn(client['client'], 'request').mockResolvedValue({
   requests: {
    nodes: [
     {
      status: RequestStatus.DELIVERED,
      statusMetadata: [{}],
     },
    ],
   },
  });

  await expect(client.queryStatus(VALID_HASH)).rejects.toThrow();
 });

 it('handles GraphQL endpoint connection error', async () => {
  jest
   .spyOn(client['client'], 'request')
   .mockRejectedValue(new Error('Failed to fetch'));

  await expect(client.queryStatus(VALID_HASH)).rejects.toThrow(
   'Failed to fetch'
  );
 });
});
