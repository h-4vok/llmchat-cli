import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWrapperServer } from '../packages/mcp-wrapper/src/server.mjs';
import { runCliProcess } from '../dist/cli-app.js';
import { adminFormat, emitAdmin } from '../dist/admin-output.js';
import { isolateCliStorage } from '../test-support/isolated-cli-storage.mjs';
import {
  createProcessClient,
  ProcessProtocolError,
} from '../packages/mcp-wrapper/src/process-client.mjs';

async function connected(client) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWrapperServer(client);
  const caller = new Client({ name: 'test', version: '1' });
  await server.connect(serverTransport);
  await caller.connect(clientTransport);
  return { server, caller };
}

test('wrapper exposes exactly chat, health, auth, and config', async (t) => {
  const { server, caller } = await connected({
    run: async () => ({
      type: 'result',
      schemaVersion: 1,
      status: 'success',
      response: { text: 'ok' },
    }),
  });
  t.after(() => Promise.all([caller.close(), server.close()]));
  assert.deepEqual(
    (await caller.listTools()).tools.map((tool) => tool.name),
    ['chat', 'health', 'auth', 'config'],
  );
});

test('wrapper forwards chat options to the subprocess boundary', async () => {
  let received;
  const { server, caller } = await connected({
    run: async (args) => {
      received = args;
      return { type: 'result', schemaVersion: 1, status: 'success', response: { text: 'ok' } };
    },
  });
  const result = await caller.callTool({
    name: 'chat',
    arguments: {
      prompt: 'hello',
      provider: 'demo',
      model: 'Pro',
      reasoning: 'deep',
      systemInstructions: 'gem',
      disposableConversation: true,
      outputFormat: 'jsonl',
    },
  });
  await Promise.all([caller.close(), server.close()]);
  assert.equal(result.structuredContent.status, 'success');
  assert.deepEqual(received, [
    'chat',
    '--provider',
    'demo',
    '--model',
    'Pro',
    '--reasoning',
    'deep',
    '--system-instructions',
    'gem',
    '--output',
    'jsonl',
    '--disposable-conversation',
    '--headless',
    '--',
    'hello',
  ]);
});

test('process boundary parses terminal JSONL and reports malformed output', async () => {
  const good = createProcessClient({ executable: process.execPath });
  const result = await good.run([
    '-e',
    "console.log(JSON.stringify({schemaVersion:1,type:'result',status:'success',response:{text:'ok'}}))",
  ]);
  assert.equal(result.response.text, 'ok');
  const bad = createProcessClient({ executable: process.execPath });
  await assert.rejects(bad.run(['-e', "console.log('not json')"]), ProcessProtocolError);
});

test('administrative formatter and config read emit versioned JSONL', async (t) => {
  await isolateCliStorage(t);
  const raw = [];
  const output = { emit() {}, raw: (value) => raw.push(value) };
  assert.deepEqual(adminFormat(['gemini']), { args: ['gemini'], format: 'text' });
  assert.deepEqual(adminFormat(['gemini', '--output', 'jsonl']), {
    args: ['gemini'],
    format: 'jsonl',
  });
  emitAdmin(output, 'health', { provider: 'demo' }, 'jsonl');
  assert.equal(JSON.parse(raw[0]).schemaVersion, 1);
  assert.throws(() => emitAdmin({ emit() {} }, 'health', {}, 'jsonl'), /raw output/);
  assert.throws(() => adminFormat(['--output', 'bad']), /Unsupported output/);
  assert.equal(
    await runCliProcess(['config', 'read', '--output', 'jsonl'], output, {
      contextFor() {},
      adapterFor() {},
    }),
    0,
  );
});

test('process boundary rejects nonzero exit and unsupported schema', async () => {
  const client = createProcessClient({ executable: process.execPath });
  await assert.rejects(
    client.run([
      '-e',
      "console.log(JSON.stringify({schemaVersion:1,type:'result',status:'success',response:{text:'ok'}}));process.exit(3)",
    ]),
    /exited with code 3/,
  );
  await assert.rejects(
    client.run([
      '-e',
      "console.log(JSON.stringify({schemaVersion:2,type:'result',status:'success'}))",
    ]),
    /schemaVersion/,
  );
});

test('process boundary supports cancellation and timeout', async () => {
  const client = createProcessClient({ executable: process.execPath, timeoutMs: 20 });
  await assert.rejects(client.run(['-e', 'setTimeout(() => {}, 1000)']), /timed out/);
  const controller = new AbortController();
  const execution = client.run(['-e', 'setTimeout(() => {}, 1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(execution, /cancelled/);
});

test('MCP maps process failures to structured error results', async () => {
  const { server, caller } = await connected({
    run: async () => {
      throw new Error('child failed');
    },
  });
  const response = await caller.callTool({ name: 'chat', arguments: { prompt: 'hello' } });
  await Promise.all([caller.close(), server.close()]);
  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.error.code, 'CHAT_FAILED');
  assert.match(response.structuredContent.error.message, /child failed/);
});
