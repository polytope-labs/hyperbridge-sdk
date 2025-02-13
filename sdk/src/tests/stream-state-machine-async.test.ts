import { jest, expect, beforeEach, afterEach } from '@jest/globals';
import { HyperIndexerClient } from '..';
import { StateMachineUpdate } from '..';

describe('stateMachineUpdateStream', () => {
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

 it('streams updates with correct data', async () => {
  const updates = [];
  for await (const update of client.stateMachineUpdateStream(
   'eth-sepolia',
   100,
   'ethereum'
  )) {
   updates.push(update);
   if (updates.length >= 2) break;
  }
  expect(updates).toEqual(mockUpdates);
 });

 it('handles network errors with retry', async () => {
  jest
   .spyOn(client['client'], 'request')
   .mockRejectedValueOnce(new Error('Network error'))
   .mockResolvedValueOnce({
    stateMachineUpdateEvents: { nodes: [mockUpdates[0]] },
   });

  const updates = [];
  for await (const update of client.stateMachineUpdateStream(
   'eth-sepolia',
   100,
   'ethereum'
  )) {
   updates.push(update);
   if (updates.length >= 1) break;
  }
  expect(updates).toEqual([mockUpdates[0]]);
 });

 it('processes updates in sequential order', async () => {
  const updates = [];
  for await (const update of client.stateMachineUpdateStream(
   'eth-sepolia',
   100,
   'ethereum'
  )) {
   updates.push(update);
   if (updates.length >= 2) break;
  }
  expect(updates[1].height).toBeGreaterThan(updates[0].height);
 });

 it('filters updates below starting height', async () => {
  const startHeight = 101;
  const updates = [];
  for await (const update of client.stateMachineUpdateStream(
   'eth-sepolia',
   startHeight,
   'ethereum'
  )) {
   updates.push(update);
   if (updates.length >= 1) break;
  }
  expect(updates[0].height).toBeGreaterThanOrEqual(startHeight);
 });
});
