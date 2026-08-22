import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import { printRootHelp } from '../dist/cli-help.js';

test('chat forwards disposable-conversation to the selected adapter', async () => {
  const calls = [];
  const adapter = {
    provider: 'gemini',
    async executeChat(request) {
      calls.push(request);
      return { text: 'answer' };
    },
    async diagnose() {
      return { state: 'progress', message: 'ready' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const runtime = {
    contextFor: () => ({
      profileDirectory: '',
      diagnosticsDirectory: '',
      screenshotsDirectory: '',
      configuration: {},
      notify() {},
    }),
    ensureSession: async () => ({ status: 'ready', source: 'reused' }),
    adapterFor: () => adapter,
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  };
  assert.equal(
    await runCliProcess(['chat', 'hello', '--disposable-conversation'], { emit() {} }, runtime),
    0,
  );
  assert.equal(calls[0].disposableConversation, true);
});

test('help documents disposable conversations and disabled mode remains false', () => {
  const events = [];
  printRootHelp({ emit: (event) => events.push(event) });
  assert.match(events[0].message, /--disposable-conversation/);
});

test('keep-browser-open remains independent from disposable conversation', async () => {
  const calls = [];
  const runtime = {
    contextFor: () => ({
      profileDirectory: '',
      diagnosticsDirectory: '',
      screenshotsDirectory: '',
      configuration: {},
      notify() {},
    }),
    ensureSession: async () => ({ status: 'ready', source: 'reused' }),
    adapterFor: () => ({
      provider: 'gemini',
      async executeChat(request) {
        calls.push(request);
        return { text: 'answer', waitForClose: async () => {} };
      },
      async diagnose() {
        return { state: 'progress', message: 'ready' };
      },
      async checkHealth() {
        return { status: 'healthy', message: 'ready' };
      },
    }),
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  };
  assert.equal(
    await runCliProcess(
      ['chat', 'hello', '--keep-browser-open', '--disposable-conversation'],
      { emit() {} },
      runtime,
    ),
    0,
  );
  assert.deepEqual(calls[0], {
    prompt: 'hello',
    model: undefined,
    systemInstructions: undefined,
    keepBrowserOpen: true,
    disposableConversation: true,
  });
});
