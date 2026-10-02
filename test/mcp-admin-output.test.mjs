import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { runCliProcess } from '../dist/cli-app.js';
import { isolateCliStorage } from '../test-support/isolated-cli-storage.mjs';

const runtime = {
  contextFor: () => ({}),
  capabilitiesFor: () => ({ authentication: 'none' }),
  adapterFor: () => ({ checkHealth: async () => ({ status: 'ready', message: 'ready' }) }),
};

for (const command of [
  ['auth', 'demo'],
  ['health', 'demo'],
  ['config', 'read'],
]) {
  for (const format of ['json', 'jsonl', 'yaml']) {
    test(`${command.join(' ')} emits only ${format} on stdout`, async (t) => {
      await isolateCliStorage(t);
      const events = [];
      const raw = [];
      const code = await runCliProcess(
        [...command, '--output', format],
        {
          emit: (event) => events.push(event),
          raw: (value) => raw.push(value),
        },
        runtime,
      );
      assert.equal(code, 0);
      assert.deepEqual(events, []);
      const result = format === 'yaml' ? parse(raw.join('')) : JSON.parse(raw.join(''));
      assert.equal(result.command, command[0]);
      assert.equal(result.status, 'success');
    });
  }
}

test('structured administrative failures preserve a terminal record', async () => {
  const raw = [];
  const events = [];
  const code = await runCliProcess(
    ['health', 'unsupported', '--output', 'jsonl'],
    {
      emit: (event) => events.push(event),
      raw: (value) => raw.push(value),
    },
    runtime,
  );
  assert.equal(code, 1);
  assert.deepEqual(events, []);
  const result = JSON.parse(raw[0]);
  assert.equal(result.status, 'failure');
  assert.match(result.error.message, /unsupported/);
});

test('structured output still requires a raw writer', async (t) => {
  await isolateCliStorage(t);
  const events = [];
  const code = await runCliProcess(
    ['config', 'read', '--output', 'jsonl'],
    {
      emit: (event) => events.push(event),
    },
    runtime,
  );
  assert.equal(code, 1);
  assert.match(events[0].message, /raw output/);
});

test('an invalid CLI output format reports its usage error', async () => {
  const events = [];
  assert.equal(
    await runCliProcess(
      ['config', 'read', '--output', 'unknown'],
      {
        emit: (event) => events.push(event),
        raw() {},
      },
      runtime,
    ),
    1,
  );
  assert.match(events[0].message, /Unsupported output format/);
});

test('config read is visible to a human without a structured format', async (t) => {
  await isolateCliStorage(t);
  const events = [];
  assert.equal(
    await runCliProcess(
      ['config', 'read'],
      {
        emit: (event) => events.push(event),
      },
      runtime,
    ),
    0,
  );
  assert.equal(JSON.parse(events[0].message).schemaVersion, 1);
});
