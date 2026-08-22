import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';

function runtimeWith(executeChat) {
  return {
    adapterFor: () => ({ provider: 'gemini', executeChat }),
    contextFor: () => ({
      profileDirectory: 'profile',
      diagnosticsDirectory: 'diagnostics',
      screenshotsDirectory: 'screenshots',
      configuration: {},
      notify() {},
    }),
    async ensureSession() {
      return { status: 'ready' };
    },
    timeout: { timeoutMs: 50 },
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

test('context provisioning failure still emits one structured terminal document', async () => {
  const runtime = runtimeWith(async () => ({ text: 'unreachable' }));
  runtime.contextFor = () => {
    throw new Error('storage unavailable');
  };
  const capture = captureOutput();

  const status = await runCliProcess(
    ['chat', 'hello', '--output', 'json'],
    capture.output,
    runtime,
  );

  assert.equal(status, 1);
  assert.deepEqual(capture.text, []);
  assert.equal(capture.raw.length, 1);
  const document = JSON.parse(capture.raw[0]);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.status, 'failure');
  assert.equal(document.error.code, 'CHAT_FAILED');
  assert.match(document.error.message, /storage unavailable/);
});

test('diagnostic persistence failure still emits one structured terminal document', async () => {
  const runtime = runtimeWith(async () => ({ text: 'answer before logging' }));
  runtime.recordChat = async () => {
    throw new Error('diagnostic write failed');
  };
  const capture = captureOutput();

  const status = await runCliProcess(
    ['chat', 'hello', '--output', 'yaml'],
    capture.output,
    runtime,
  );

  assert.equal(status, 1);
  assert.deepEqual(capture.text, []);
  assert.equal(capture.raw.length, 1);
  assert.match(capture.raw[0], /status: failure/);
  assert.match(capture.raw[0], /diagnostic write failed/);
  assert.match(capture.raw[0], /answer before logging/);
});
