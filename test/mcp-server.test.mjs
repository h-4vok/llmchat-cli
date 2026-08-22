import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/mcp-server.js';

async function connectedClient(runtime, config = memoryConfig()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ runtime, config });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function runtimeFixture() {
  const requests = [];
  const sessions = [];
  const listeners = new Set();
  return {
    requests,
    sessions,
    adapterFor: () => ({
      provider: 'gemini',
      async executeChat(request) {
        requests.push(request);
        listeners.forEach((listener) => listener({ kind: 'progress', message: 'working' }));
        return { text: 'answer' };
      },
      async diagnose() {
        return { state: 'progress', message: 'available' };
      },
    }),
    contextFor: () => ({
      profileDirectory: 'profile',
      diagnosticsDirectory: 'diagnostics',
      screenshotsDirectory: 'screenshots',
      configuration: {},
      notify() {},
      onActivity(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    async ensureSession(_provider, _context, options) {
      sessions.push(options);
      return { status: 'ready' };
    },
    timeout: { timeoutMs: 100 },
  };
}

function memoryConfig(provider = 'gemini') {
  return { read: () => ({ schemaVersion: 1, defaultProvider: provider }) };
}

function text(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  return result.content[0].text;
}

test('MCP advertises one purpose-built LLM consultation tool', async (t) => {
  const { client, server } = await connectedClient(runtimeFixture());
  t.after(() => Promise.all([client.close(), server.close()]));
  const listed = await client.listTools();

  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ['ask_llm'],
  );
  const tool = listed.tools[0];
  assert.equal(tool.title, 'Ask an LLM');
  assert.match(tool.description, /ask|consult/i);
  assert.match(tool.description, /Gemini/);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), [
    'disposableConversation',
    'model',
    'prompt',
    'provider',
    'reasoning',
  ]);
  assert.deepEqual(tool.inputSchema.properties.provider.enum, ['gemini', 'demo']);
  assert.equal(tool.inputSchema.properties.disposableConversation.default, true);
  assert.deepEqual(tool.inputSchema.required, ['prompt']);
  assert.ok(tool.outputSchema.properties.response);
  assert.ok(tool.outputSchema.properties.error);
  assert.doesNotMatch(
    JSON.stringify(tool.inputSchema),
    /outputFormat|keepBrowserOpen|systemInstructions/,
  );
});

test('MCP instructions teach Codex natural LLMChat and Gemini delegation', async (t) => {
  const { client, server } = await connectedClient(runtimeFixture());
  t.after(() => Promise.all([client.close(), server.close()]));
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

test('ask_llm defaults to a disposable conversation and structured transcript', async (t) => {
  const runtime = runtimeFixture();
  const { client, server } = await connectedClient(runtime);
  t.after(() => Promise.all([client.close(), server.close()]));
  const result = await client.callTool({
    name: 'ask_llm',
    arguments: { prompt: 'hello' },
  });

  assert.equal(result.isError, undefined);
  assert.equal(text(result), 'answer');
  assert.equal(result.structuredContent.provider, 'gemini');
  assert.equal(result.structuredContent.status, 'success');
  assert.equal(result.structuredContent.response.text, 'answer');
  assert.deepEqual(runtime.requests, [
    {
      prompt: 'hello',
      model: undefined,
      reasoning: undefined,
      disposableConversation: true,
    },
  ]);
  assert.deepEqual(runtime.sessions, [{ interactive: false }]);
});

test('ask_llm forwards explicit model, reasoning, and persistent conversation intent', async (t) => {
  const runtime = runtimeFixture();
  const { client, server } = await connectedClient(runtime);
  t.after(() => Promise.all([client.close(), server.close()]));
  await client.callTool({
    name: 'ask_llm',
    arguments: {
      prompt: 'hello',
      provider: 'demo',
      model: 'requested-model',
      reasoning: 'requested-reasoning',
      disposableConversation: false,
    },
  });

  assert.deepEqual(runtime.requests[0], {
    prompt: 'hello',
    model: 'requested-model',
    reasoning: 'requested-reasoning',
    disposableConversation: false,
  });
});
