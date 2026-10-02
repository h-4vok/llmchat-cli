import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWrapperServer } from '../packages/mcp-wrapper/src/server.mjs';
import { createMcpServer } from '../dist/mcp-server.js';

async function connect(t, server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'visibility-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(() => Promise.all([client.close(), server.close()]));
  return client;
}

for (const command of ['chat', 'health', 'auth']) {
  test(`wrapper ${command} hides browsers by default`, async (t) => {
    let received;
    const client = await connect(
      t,
      createWrapperServer({
        run: async (args) => {
          received = args;
          return { schemaVersion: 1, type: 'result', status: 'success', response: { text: 'ok' } };
        },
      }),
    );
    await client.callTool({ name: command, arguments: { provider: 'gemini', prompt: 'hello' } });
    assert.ok(received.includes('--headless'));
  });
}

for (const command of ['chat', 'health']) {
  test(`wrapper ${command} shows the browser only on explicit request`, async (t) => {
    let received;
    const client = await connect(
      t,
      createWrapperServer({
        run: async (args) => {
          received = args;
          return { schemaVersion: 1, type: 'result', status: 'success', response: { text: 'ok' } };
        },
      }),
    );
    await client.callTool({
      name: command,
      arguments: { provider: 'gemini', prompt: 'hello', headless: false },
    });
    assert.ok(!received.includes('--headless'));
  });
}

for (const headless of [undefined, false]) {
  test(`in-process MCP forwards browser intent: ${headless}`, async (t) => {
    let received;
    const runtime = {
      contextFor: () => ({ configuration: {}, notify() {} }),
      adapterFor: () => ({
        executeChat: async (request) => {
          received = request;
          return { text: 'ok' };
        },
      }),
      timeout: { timeoutMs: 100 },
    };
    const client = await connect(t, createMcpServer({ runtime }));
    const arguments_ = { provider: 'demo', prompt: 'hello' };
    if (headless !== undefined) arguments_.headless = headless;
    const result = await client.callTool({ name: 'ask_llm', arguments: arguments_ });
    assert.equal(result.isError, undefined);
    assert.equal(received.headless, headless ?? true);
  });
}
test('MCP instructions teach Codex natural LLMChat and Gemini delegation', async (t) => {
  const client = await connect(t, createMcpServer({ runtime: {} }));
  const instructions = client.getInstructions();

  assert.match(instructions, /LLMChat/);
  assert.match(instructions, /Gemini/);
  assert.match(instructions, /ask_llm/);
  assert.match(instructions, /asks to use LLMChat/i);
  assert.match(instructions, /ask or consult Gemini/i);
  assert.match(instructions, /delegate work to Gemini/i);
  assert.match(instructions, /second opinion from Gemini/i);
  assert.match(instructions, /omit model and reasoning unless/i);
  assert.match(instructions, /disposable/i);
});
