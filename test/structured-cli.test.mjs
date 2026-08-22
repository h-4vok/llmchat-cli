import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';

function runtimeWith(executeChat, ensureSession = async () => ({ status: 'ready' })) {
  const listeners = new Set();
  return {
    adapterFor: () => ({
      provider: 'gemini',
      executeChat,
      async diagnose() {
        return { state: 'error', message: 'timed out' };
      },
      async checkHealth() {
        return { status: 'healthy', message: 'ready' };
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
    ensureSession,
    timeout: { timeoutMs: 50 },
    activity(event) {
      listeners.forEach((listener) => listener(event));
    },
  };
}

function captureOutput() {
  const text = [];
  const raw = [];
  return {
    output: { emit: (event) => text.push(event), raw: (value) => raw.push(value) },
    text,
    raw,
  };
}

test('structured CLI success includes effective options and ordered activity', async () => {
  let runtime;
  runtime = runtimeWith(async () => {
    runtime.activity({ kind: 'progress', message: 'opening' });
    return { text: 'answer' };
  });
  const capture = captureOutput();

  const status = await runCliProcess(
    ['chat', 'hello', '--model', 'Pro', '--output', 'jsonl'],
    capture.output,
    runtime,
  );

  assert.equal(status, 0);
  assert.deepEqual(capture.text, []);
  const records = capture.raw[0].trimEnd().split('\n').map(JSON.parse);
  assert.equal(records[0].type, 'activity');
  assert.equal(records[1].type, 'result');
  assert.equal(records[1].schemaVersion, 1);
  assert.deepEqual(records[1].options, {
    model: 'Pro',
    prompt: 'hello',
    keepBrowserOpen: false,
    disposableConversation: false,
  });
});

test('structured CLI returns a terminal failure and non-zero status', async () => {
  const runtime = runtimeWith(async () => {
    throw new Error('provider exploded');
  });
  const capture = captureOutput();

  const status = await runCliProcess(
    ['chat', 'hello', '--output', 'json'],
    capture.output,
    runtime,
  );

  assert.equal(status, 1);
  const document = JSON.parse(capture.raw[0]);
  assert.equal(document.status, 'failure');
  assert.deepEqual(document.error, { code: 'CHAT_FAILED', message: '[error] provider exploded' });
});

test('timeout becomes one structured terminal failure', async () => {
  let expire;
  const runtime = runtimeWith(() => new Promise(() => {}));
  runtime.timeout = {
    timeoutMs: 10,
    schedule: (callback) => {
      expire = callback;
      return () => {};
    },
  };
  runtime.adapterFor = () => ({
    provider: 'gemini',
    executeChat: (_request, _context, signal) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => resolve({ text: 'cancelled' })),
      ),
    async diagnose() {
      return { state: 'error', message: 'provider stalled' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  });
  const capture = captureOutput();
  const execution = runCliProcess(['chat', 'hello', '--output', 'jsonl'], capture.output, runtime);

  await Promise.resolve();
  await Promise.resolve();
  expire();
  const status = await execution;

  assert.equal(status, 1);
  const records = capture.raw[0].trimEnd().split('\n').map(JSON.parse);
  assert.equal(records.filter((record) => record.type === 'result').length, 1);
  assert.match(records.at(-1).error.message, /timed out.*provider stalled/i);
});

test('session-required is a structured failure without invoking the provider', async () => {
  let executed = false;
  const runtime = runtimeWith(
    async () => {
      executed = true;
      return { text: 'unreachable' };
    },
    async () => ({ status: 'indeterminate' }),
  );
  const capture = captureOutput();

  const status = await runCliProcess(
    ['chat', 'hello', '--output', 'yaml'],
    capture.output,
    runtime,
  );

  assert.equal(status, 1);
  assert.equal(executed, false);
  assert.match(capture.raw[0], /status: failure/);
  assert.match(capture.raw[0], /code: CHAT_FAILED/);
});

test('structured output requires a raw writer at the CLI boundary', async () => {
  const events = [];
  const status = await runCliProcess(
    ['chat', 'hello', '--output', 'json'],
    { emit: (event) => events.push(event) },
    runtimeWith(async () => ({ text: 'answer' })),
  );
  assert.equal(status, 1);
  assert.match(events[0].message, /raw output writer/);
});
