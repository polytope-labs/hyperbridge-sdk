import { HyperClient } from '../client';
import { RequestStatus } from '../types';

describe('HyperClient', () => {
 let client: HyperClient;
 const VALID_HASH = '0x1234567890abcdef';
 const INVALID_HASH = '0xinvalid';
 const TIMED_OUT_HASH = '0xdeadbeef';

 beforeEach(() => {
  client = new HyperClient();
 });

 describe('queryStatus', () => {
  it('returns correct status for valid hash', async () => {
   const status = await client.queryStatus(VALID_HASH);
   expect(status).toHaveProperty('status');
   expect(status).toHaveProperty('metadata');
  });

  it('throws error for invalid hash format', async () => {
   await expect(client.queryStatus(INVALID_HASH)).rejects.toThrow(
    'Invalid hash format'
   );
  });

  it('throws error when request not found', async () => {
   await expect(client.queryStatus('0x0000000000000000')).rejects.toThrow(
    'No request found'
   );
  });

  it('handles timed out requests', async () => {
   const status = await client.queryStatus(TIMED_OUT_HASH);
   expect(status.status).toBe(RequestStatus.TIMED_OUT);
  });
 });

 describe('statusStream', () => {
  it('streams status updates until terminal state', async () => {
   const updates = [];
   for await (const update of client.statusStream(VALID_HASH)) {
    updates.push(update);
   }
   expect(updates.length).toBeGreaterThan(0);
  });

  it('stops streaming after timeout', async () => {
   const updates = [];
   for await (const update of client.statusStream(TIMED_OUT_HASH)) {
    updates.push(update);
   }
   expect(updates[updates.length - 1].status).toBe(RequestStatus.TIMED_OUT);
  });

  it('handles network interruptions', async () => {
   // Simulate network failure
   jest
    .spyOn(client['client'], 'request')
    .mockRejectedValueOnce(new Error('Network error'));

   const updates = [];
   for await (const update of client.statusStream(VALID_HASH)) {
    updates.push(update);
    if (updates.length >= 2) break;
   }
   expect(updates.length).toBeGreaterThan(0);
  });
 });

 describe('stateMachineUpdateStream', () => {
  it('streams updates for valid parameters', async () => {
   const updates = [];
   for await (const update of client.stateMachineUpdateStream(
    'eth-sepolia',
    100,
    'ethereum'
   )) {
    updates.push(update);
    if (updates.length >= 2) break;
   }
   expect(updates[0].height).toBeGreaterThanOrEqual(100);
  });

  it('throws error for invalid chain', async () => {
   await expect(
    client.stateMachineUpdateStream('invalid-chain', 100, 'invalid').next()
   ).rejects.toThrow('Invalid chain specified');
  });

  it('handles negative height values', async () => {
   await expect(
    client.stateMachineUpdateStream('eth-sepolia', -1, 'ethereum').next()
   ).rejects.toThrow('Height must be non-negative');
  });

  it('handles empty update responses', async () => {
   const updates = [];
   for await (const update of client.stateMachineUpdateStream(
    'eth-sepolia',
    999999999,
    'ethereum'
   )) {
    updates.push(update);
    break;
   }
   expect(updates.length).toBe(0);
  });
 });
});
