import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { createProcessClient } from '../packages/mcp-wrapper/src/process-client.mjs';
import { fragmentedCliProcess } from '../test-support/fragmented-cli-process.mjs';

const fixture = resolve('test-support/fake-jsonl-cli.mjs');
const client = () => createProcessClient({ executable: process.execPath });

test('subprocess preserves multiline Unicode, quotes, flags and shell characters as data', async () => {
  const prompt = 'Analizá issue 84\n"a quoted detail" & echo unsafe | more < > %PATH% ! ^';
  const result = await client().run([fixture, 'echo', prompt, '--model', 'Extended thinking']);
  assert.deepEqual(result.args, [prompt, '--model', 'Extended thinking']);
});

test('nonzero failure keeps the provider diagnostic and partial response', async () => {
  const result = await client().run([fixture, 'failure']);
  assert.equal(result.status, 'failure');
  assert.equal(result.error.message, 'Run llmchat auth gemini');
  assert.equal(result.response.text, 'ok');
});

test('activity remains available to the MCP caller', async () => {
  const result = await client().run([fixture, 'activity']);
  assert.deepEqual(result.activity, [{ kind: 'warning', message: 'model unavailable' }]);
});

for (const [mode, message] of [
  ['malformed', /Invalid llmchat JSONL/],
  ['invalid', /Invalid llmchat result/],
  ['empty', /terminal JSONL.*diagnostic only/],
  ['nonzero', /code 3.*child diagnostic/],
  ['version', /schemaVersion/],
]) {
  test(`subprocess reports ${mode} with context`, async () => {
    await assert.rejects(client().run([fixture, mode]), message);
  });
}

test('cancellation already requested never starts an executable', async () => {
  const controller = new AbortController();
  controller.abort();
  const missing = createProcessClient({ executable: resolve('does-not-exist.exe') });
  await assert.rejects(missing.run([], { signal: controller.signal }), /cancelled/);
});

test('timeout and cancellation terminate a running process', async () => {
  const timed = createProcessClient({ executable: process.execPath, timeoutMs: 100 });
  await assert.rejects(timed.run([fixture, 'wait']), /timed out/);
  const controller = new AbortController();
  const execution = client().run([fixture, 'wait'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(execution, /cancelled/);
});

test('startup failure reports the executable problem', async () => {
  const missing = createProcessClient({ executable: resolve('does-not-exist.exe') });
  await assert.rejects(missing.run([]), /Unable to start llmchat/);
});

test('the outer deadline allows the CLI 180 second execution budget plus session preparation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = client().run([fixture, 'echo', 'long consultation']);
  t.mock.timers.tick(210000);
  assert.equal((await result).response.text, 'ok');
});

test('fragmented UTF-8 stdout retains the exact provider response', async () => {
  const client = createProcessClient({
    executable: process.execPath,
    spawn: fragmentedCliProcess('success'),
  });
  const result = await client.run([]);
  assert.equal(result.response.text, 'Análisis 🌍');
});

test('fragmented UTF-8 stderr retains the exact process diagnostic', async () => {
  const client = createProcessClient({
    executable: process.execPath,
    spawn: fragmentedCliProcess('failure'),
  });
  await assert.rejects(client.run([]), {
    message: 'llmchat exited with code 3. stderr: Análisis 🌍',
  });
});
