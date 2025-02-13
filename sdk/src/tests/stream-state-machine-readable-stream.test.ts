import { jest, expect, beforeEach, afterEach } from '@jest/globals';
import { HyperIndexerClient } from '..';
import { StateMachineUpdate } from '..';

describe('createStateMachineUpdateStream', () => {
 let client: HyperIndexerClient;

 const mockUpdates: StateMachineUpdate[] = [
  {
   height: 100,
   chain: '11155111',
   blockHash: '0xabc123',
   blockNumber: 1000,
   transactionHash: '0xdef456',
   transactionIndex: 0,
   createdAt: new Date('2024-01-01'),
   stateMachineId: 'eth-sepolia',
  },
  {
   height: 101,
   chain: '11155111',
   blockHash: '0xabc124',
   blockNumber: 1001,
   transactionHash: '0xdef457',
   transactionIndex: 1,
   createdAt: new Date('2024-01-02'),
   stateMachineId: 'eth-sepolia',
  },
 ];

 beforeEach(() => {
  client = new HyperIndexerClient();
  client['pollInterval'] = 100;
  jest.spyOn(client['client'], 'request').mockResolvedValue({
   stateMachineUpdateEvents: {
    nodes: mockUpdates,
   },
  });
 });

 afterEach(() => {
  jest.clearAllMocks();
  // Clear any pending timers
  jest.useRealTimers();
 });

 jest.setTimeout(60000);

 it('emits updates with correct data', async () => {
  const stream = client.createStateMachineUpdateStream(
   'eth-sepolia',
   100,
   'ethereum'
  );
  const reader = stream.getReader();

  const updates = [];
  while (true) {
   const { done, value } = await reader.read();
   if (done || updates.length >= 2) break;
   if (value) updates.push(value);
  }

  reader.releaseLock();

  expect(updates).toEqual(mockUpdates);
 });

 it('handles network errors with retry', async () => {
  jest
   .spyOn(client['client'], 'request')
   .mockRejectedValueOnce(new Error('Network error'))
   .mockResolvedValueOnce({
    stateMachineUpdateEvents: { nodes: [mockUpdates[0]] },
   });

  const stream = client.createStateMachineUpdateStream(
   'eth-sepolia',
   100,
   'ethereum'
  );
  const reader = stream.getReader();

  const { value } = await reader.read();
  expect(value).toEqual(mockUpdates[0]);
 });

 it('processes updates in sequential order', async () => {
  const stream = client.createStateMachineUpdateStream(
   'eth-sepolia',
   100,
   'ethereum'
  );
  const reader = stream.getReader();

  const updates = [];
  while (true) {
   const { done, value } = await reader.read();
   if (done || updates.length >= 2) break;
   if (value) updates.push(value);
  }

  reader.releaseLock();

  expect(updates[1].height).toBeGreaterThan(updates[0].height);
 });

 it('filters updates below starting height', async () => {
  const startHeight = 101;
  const stream = client.createStateMachineUpdateStream(
   'eth-sepolia',
   startHeight,
   'ethereum'
  );
  const reader = stream.getReader();

  const { value } = await reader.read();
  expect(value!.height).toBeGreaterThanOrEqual(startHeight);
 });
});
