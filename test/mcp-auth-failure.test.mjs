import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/mcp-server.js';

test('ask_llm returns an actionable canonical authentication failure', async (t) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ runtime: failingRuntime(), config: memoryConfig() });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({ name: 'ask_llm', arguments: { prompt: 'hello' } });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /llmchat auth gemini/);
  assert.equal(result.structuredContent.status, 'failure');
  assert.equal(result.structuredContent.error.code, 'CHAT_FAILED');
});

function memoryConfig() {
  return { read: () => ({ schemaVersion: 1, defaultProvider: 'gemini' }) };
}

function failingRuntime() {
  return {
    adapterFor: () => ({
      provider: 'gemini',
      executeChat: async () => assert.fail('provider must not run'),
    }),
    contextFor: () => ({
      profileDirectory: 'profile',
      diagnosticsDirectory: 'diagnostics',
      screenshotsDirectory: 'screenshots',
      configuration: {},
      notify() {},
      onActivity: () => () => {},
    }),
    ensureSession: async () => ({ status: 'authentication-required' }),
    timeout: { timeoutMs: 100 },
  };
}
