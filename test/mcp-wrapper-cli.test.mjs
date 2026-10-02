import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createProcessClient } from '../packages/mcp-wrapper/src/process-client.mjs';
import { connectWrapper } from '../test-support/mcp-wrapper-fixture.mjs';
import { isolateCliStorage } from '../test-support/isolated-cli-storage.mjs';

test('all four MCP tools work across the actual CLI subprocess using isolated demo storage', async (t) => {
  await isolateCliStorage(t);
  const processClient = createProcessClient({ executable: resolve('dist/cli.js') });
  const caller = await connectWrapper(t, processClient.run);
  const call = (name, args) =>
    caller.callTool({ name, arguments: args }, undefined, { timeout: 330000 });
  const prompt = 'Refiná este issue\nTítulo: "a & b"\nCriterio: guardar el contexto exacto.';
  const chat = await call('chat', { provider: 'demo', prompt });
  assert.notEqual(chat.isError, true, JSON.stringify(chat.structuredContent));
  assert.equal(chat.structuredContent.response.text, `Demo response: ${prompt}`);
  assert.equal(chat.structuredContent.options.disposableConversation, true);
  for (const prompt of ['--help', '-h', '--output']) {
    const response = await call('chat', { provider: 'demo', prompt });
    assert.notEqual(response.isError, true, JSON.stringify(response.structuredContent));
    assert.equal(response.structuredContent.response.text, `Demo response: ${prompt}`);
  }
  for (const name of ['auth', 'health']) {
    const result = await call(name, { provider: 'demo' });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.data.provider, 'demo');
  }
  const set = await call('config', { action: 'set-default-provider', provider: 'demo' });
  assert.equal(set.structuredContent.data.defaultProvider, 'demo');
  const read = await call('config', { action: 'read' });
  assert.equal(read.structuredContent.data.defaultProvider, 'demo');
  const defaultChat = await call('chat', { prompt: 'configured default' });
  assert.equal(defaultChat.structuredContent.provider, 'demo');
  const clear = await call('config', { action: 'clear-default-provider' });
  assert.equal(clear.structuredContent.data.defaultProvider, 'gemini');
  const failure = await call('chat', { provider: 'unsupported', prompt: 'hello' });
  assert.equal(failure.isError, true);
  assert.match(failure.structuredContent.error.message, /Unsupported provider/);
});
