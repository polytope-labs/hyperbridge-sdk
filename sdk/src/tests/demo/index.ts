import { HyperIndexerClient } from '../../client';

const client = new HyperIndexerClient();

async function testStatus(hash: string) {
 // Test status query
 const status = await client.queryStatus(hash);
 console.log('Status:', status);
}

async function testStatusStream(hash: string) {
 // Test status readable stream
 console.log('\nTesting status readable stream:');
 const statusStream = client.createStatusStream(hash);
 const statusReader = statusStream.getReader();
 while (true) {
  const { value, done } = await statusReader.read();
  if (done) break;
  console.log('Status Update:', value);
 }
 statusReader.releaseLock();
}

async function testStateMachineStream(
 stateMachineId: string,
 height: number,
 chain: string
) {
 // Test state machine updates readable stream
 console.log('\nTesting state machine readable stream:');
 const readableStateStream = client.createStateMachineUpdateStream(
  stateMachineId,
  height,
  chain
 );
 const stateReader = readableStateStream.getReader();
 for (let i = 0; i < 5; i++) {
  const { value, done } = await stateReader.read();
  if (done) break;
  console.log('Readable State Update:', value);
 }
 stateReader.releaseLock();
}

// test();

// 14:22
// 14:42
