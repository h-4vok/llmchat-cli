import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { connectWrapper, success } from '../test-support/mcp-wrapper-fixture.mjs';

test('discovery explains named providers and supplying issue context', async (t) => {
  const caller = await connectWrapper(t, async () => success);
  const { tools } = await caller.listTools();
  const chat = tools.find(({ name }) => name === 'chat');
  assert.match(chat.description, /Gemini/);
  assert.match(chat.inputSchema.properties.prompt.description, /context/i);
  assert.equal(chat.inputSchema.properties.disposableConversation.default, true);
  for (const tool of tools) assert.ok(tool.description?.length);
});

test('clear-default-provider needs no provider and runs its CLI action', async (t) => {
  const calls = [];
  const caller = await connectWrapper(t, async (args) => {
    calls.push(args);
    return success;
  });
  const result = await caller.callTool({
    name: 'config',
    arguments: { action: 'clear-default-provider' },
  });
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, [['config', 'clear-default-provider', '--output', 'jsonl']]);
});

test('invalid argument values never invoke the CLI', async (t) => {
  const calls = [];
  const caller = await connectWrapper(t, async (args) => {
    calls.push(args);
    return success;
  });
  for (const arguments_ of [{ prompt: ' ' }, { prompt: 'ok', provider: '' }]) {
    const result = await caller.callTool({ name: 'chat', arguments: arguments_ });
    assert.equal(result.isError, true);
  }
  assert.deepEqual(calls, []);
});

for (const outputFormat of ['text', 'json', 'jsonl', 'yaml']) {
  test(`chat renders ${outputFormat} while retaining its structured result`, async (t) => {
    const caller = await connectWrapper(t, async () => success);
    const result = await caller.callTool({
      name: 'chat',
      arguments: { prompt: 'hello', outputFormat },
    });
    assert.equal(result.structuredContent.response.text, 'ok');
    const text = result.content[0].text;
    if (outputFormat === 'text') assert.equal(text, 'ok');
    else
      assert.equal((outputFormat === 'yaml' ? parse(text) : JSON.parse(text)).response.text, 'ok');
  });
}

test('provider failures prefer their error even when a partial response exists', async (t) => {
  const caller = await connectWrapper(t, async () => ({
    ...success,
    status: 'failure',
    error: { code: 'CHAT_FAILED', message: 'session required' },
  }));
  const result = await caller.callTool({ name: 'chat', arguments: { prompt: 'hello' } });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'session required');
  assert.equal(result.structuredContent.response.text, 'ok');
});

test('process failures honor the selected output format', async (t) => {
  const caller = await connectWrapper(t, async () => {
    throw new Error('child unavailable');
  });
  const result = await caller.callTool({
    name: 'chat',
    arguments: { prompt: 'hello', outputFormat: 'json' },
  });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error.message, 'child unavailable');
});
