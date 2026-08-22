import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/mcp-server.js';

test('invalid ask_llm inputs do not execute provider or configuration ports', async (t) => {
  const calls = [];
  const runtime = {
    adapterFor() {
      calls.push('adapter');
      throw new Error('provider boundary must not execute');
    },
    contextFor() {
      calls.push('context');
      throw new Error('context boundary must not execute');
    },
    timeout: { timeoutMs: 10 },
  };
  const config = {
    read() {
      calls.push('read');
      return {};
    },
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ runtime, config });
  const client = new Client({ name: 'validation-test', version: '1.0.0' });
  t.after(() => Promise.all([client.close(), server.close()]));
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  for (const arguments_ of [
    {},
    { prompt: '' },
    { prompt: 'hello', provider: 'unknown' },
    { prompt: 'hello', disposableConversation: 'yes' },
  ]) {
    const result = await client.callTool({ name: 'ask_llm', arguments: arguments_ });
    assert.equal(result.isError, true);
  }
  assert.deepEqual(calls, []);
});
