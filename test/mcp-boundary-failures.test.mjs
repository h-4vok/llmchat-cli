import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/mcp-server.js';

async function fixture(runtime) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ runtime });
  const client = new Client({ name: 'boundary-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function runtime() {
  return {
    adapterFor: () => ({
      provider: 'gemini',
      async executeChat() {
        return { text: 'answer before release' };
      },
    }),
    contextFor: () => ({
      profileDirectory: 'profile',
      diagnosticsDirectory: 'diagnostics',
      screenshotsDirectory: 'screenshots',
      configuration: {},
      notify() {},
    }),
    timeout: { timeoutMs: 50 },
  };
}

function text(result) {
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

test('MCP structures context creation failure', async (t) => {
  const failing = runtime();
  failing.contextFor = () => {
    throw new Error('storage unavailable');
  };
  const { client, server } = await fixture(failing);
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({
    name: 'ask_llm',
    arguments: { prompt: 'hello' },
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.schemaVersion, 1);
  assert.equal(result.structuredContent.status, 'failure');
  assert.equal(result.structuredContent.error.code, 'CHAT_FAILED');
});

test('MCP preserves the partial response when context release fails', async (t) => {
  const failing = runtime();
  failing.releaseContext = async () => {
    throw new Error('release failed');
  };
  const { client, server } = await fixture(failing);
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({
    name: 'ask_llm',
    arguments: { prompt: 'hello' },
  });

  assert.equal(result.isError, true);
  assert.match(text(result), /release failed/);
  assert.equal(result.structuredContent.error.code, 'CHAT_FAILED');
  assert.equal(result.structuredContent.response.text, 'answer before release');
});

test('MCP normalizes an unexpected execution-boundary failure', async (t) => {
  const failing = runtime();
  const contextFor = failing.contextFor;
  failing.contextFor = () => ({
    ...contextFor(),
    onActivity() {
      throw new Error('activity subscription failed');
    },
  });
  const { client, server } = await fixture(failing);
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({
    name: 'ask_llm',
    arguments: { prompt: 'hello' },
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'CHAT_FAILED');
  assert.match(result.structuredContent.error.message, /activity subscription failed/);
});
