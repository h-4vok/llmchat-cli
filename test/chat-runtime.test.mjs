import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatRuntime } from '../dist/chat-runtime.js';
import { runCliProcess } from '../dist/cli-app.js';

const paths = {
  root: '/data/llmchat',
  profileDirectory: '/data/llmchat/profiles/gemini',
  logsDirectory: '/data/llmchat/logs/gemini',
  diagnosticsDirectory: '/data/llmchat/diagnostics/gemini',
  screenshotsDirectory: '/data/llmchat/screenshots/gemini',
};

test('chat context provisions secure storage before exposing its paths', () => {
  const calls = [];
  const runtime = createChatRuntime((provider) => {
    calls.push(provider);
    return paths;
  });

  const context = runtime.contextFor('gemini');

  assert.deepEqual(calls, ['gemini']);
  assert.equal(context.profileDirectory, paths.profileDirectory);
  assert.equal(context.diagnosticsDirectory, paths.diagnosticsDirectory);
});

test('storage provisioning failures prevent adapter context creation', () => {
  const runtime = createChatRuntime(() => {
    throw new Error('secure storage unavailable');
  });

  assert.throws(() => runtime.contextFor('gemini'), /secure storage unavailable/);
});

test('CLI provisions context before obtaining or executing the adapter', async () => {
  const calls = [];
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      calls.push('execute');
      return { text: 'done' };
    },
    async diagnose() {
      return { state: 'progress', message: 'unused' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const runtime = {
    contextFor() {
      calls.push('storage');
      return { ...paths, configuration: {}, notify() {} };
    },
    adapterFor() {
      calls.push('adapter');
      return adapter;
    },
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  };
  const output = { emit: () => {} };

  assert.equal(await runCliProcess(['chat', '--provider', 'gemini', 'hello'], output, runtime), 0);
  assert.deepEqual(calls, ['storage', 'adapter', 'execute']);
});
