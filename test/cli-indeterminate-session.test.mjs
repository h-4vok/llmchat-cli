import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';

const context = {
  profileDirectory: 'profiles/gemini',
  diagnosticsDirectory: 'diagnostics/gemini',
  screenshotsDirectory: 'screenshots/gemini',
  configuration: {},
  notify() {},
};

function runtime(calls) {
  return {
    contextFor: () => context,
    async ensureSession() {
      calls.push('session');
      return { status: 'indeterminate' };
    },
    adapterFor() {
      calls.push('adapter');
      return {};
    },
    timeout: { timeoutMs: 10 },
  };
}

test('indeterminate Gemini login reports manual auth and never submits chat', async () => {
  const calls = [];
  const events = [];
  const status = await runCliProcess(
    ['chat', 'hello', '--provider', 'gemini'],
    { emit: (event) => events.push(event) },
    runtime(calls),
  );
  assert.equal(status, 1);
  assert.deepEqual(calls, ['session']);
  assert.match(events[0].message, /Gemini needs login/i);
});

test('auth reports indeterminate Gemini login instead of succeeding', async () => {
  const calls = [];
  const events = [];
  const status = await runCliProcess(
    ['auth', 'gemini'],
    { emit: (event) => events.push(event) },
    runtime(calls),
  );
  assert.equal(status, 1);
  assert.deepEqual(calls, ['session']);
  assert.match(events[0].message, /Gemini needs login/i);
});
