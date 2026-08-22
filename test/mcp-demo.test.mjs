import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/mcp-server.js';
import { createRealChatRuntime } from '../dist/real-chat-runtime.js';

async function connect(runtime, defaultProvider = 'gemini') {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const configured = defaultProvider === null ? {} : { defaultProvider };
  const config = { read: () => ({ schemaVersion: 1, ...configured }) };
  const server = createMcpServer({ runtime, config });
  const client = new Client({ name: 'demo-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function localRuntime() {
  return createRealChatRuntime({
    provisionStorage: (provider) => ({
      profileDirectory: `/profiles/${provider}`,
      diagnosticsDirectory: `/diagnostics/${provider}`,
      screenshotsDirectory: `/screenshots/${provider}`,
    }),
    adapter: {
      provider: 'gemini',
      executeChat: async () => ({ text: 'gemini answer' }),
      diagnose: async () => ({ state: 'progress', message: 'ready' }),
    },
    sessionPorts: {
      browser: {
        checkSession: async () => 'usable',
        openLoginBrowser: async () => assert.fail('login must not open'),
      },
      notifications: { send: async () => {} },
    },
    recordChat: () => {},
  });
}

test('ask_llm executes an explicit demo provider locally', async (t) => {
  const { client, server } = await connect(localRuntime());
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({
    name: 'ask_llm',
    arguments: { prompt: 'hello', provider: 'demo' },
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.provider, 'demo');
  assert.equal(result.structuredContent.options.disposableConversation, true);
  assert.equal(result.structuredContent.response.text, 'Demo response: hello');
});

test('ask_llm uses the default provider configured by the CLI', async (t) => {
  const { client, server } = await connect(localRuntime(), 'demo');
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({ name: 'ask_llm', arguments: { prompt: 'default' } });

  assert.equal(result.structuredContent.provider, 'demo');
  assert.equal(result.structuredContent.response.text, 'Demo response: default');
});

test('ask_llm uses the factory provider when CLI configuration omits a default', async (t) => {
  const { client, server } = await connect(localRuntime(), null);
  t.after(() => Promise.all([client.close(), server.close()]));

  const result = await client.callTool({
    name: 'ask_llm',
    arguments: { prompt: 'hello' },
  });

  assert.equal(result.structuredContent.provider, 'gemini');
});

test('MCP does not expose CLI administration as tools', async (t) => {
  const { client, server } = await connect(localRuntime());
  t.after(() => Promise.all([client.close(), server.close()]));

  for (const name of ['chat', 'health', 'auth', 'config']) {
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/i);
  }
});
