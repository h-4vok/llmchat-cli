import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWrapperServer } from '../packages/mcp-wrapper/src/server.mjs';

async function connected(client) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWrapperServer(client);
  const caller = new Client({ name: 'test', version: '1' });
  await server.connect(serverTransport);
  await caller.connect(clientTransport);
  return { server, caller };
}

test('administrative validation rejects missing values before spawning', async () => {
  let spawned = false;
  const { server, caller } = await connected({
    run: async () => {
      spawned = true;
      return {};
    },
  });
  const health = await caller.callTool({ name: 'health', arguments: {} });
  const config = await caller.callTool({
    name: 'config',
    arguments: { action: 'set-default-provider' },
  });
  await Promise.all([caller.close(), server.close()]);
  assert.equal(health.isError, true);
  assert.equal(config.isError, true);
  assert.equal(spawned, false);
});

test('chat normalizes every requested output format to JSONL at the child boundary', async () => {
  let received;
  const { server, caller } = await connected({
    run: async (args) => {
      received = args;
      return { type: 'result', schemaVersion: 1, status: 'success', response: { text: 'ok' } };
    },
  });
  await caller.callTool({ name: 'chat', arguments: { prompt: 'hello', outputFormat: 'yaml' } });
  await Promise.all([caller.close(), server.close()]);
  assert.deepEqual(received, ['chat', 'hello', '--output', 'jsonl']);
});
