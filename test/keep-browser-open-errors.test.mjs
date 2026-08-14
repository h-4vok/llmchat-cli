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

test('request failure ends kept chat without waiting for browser close', async () => {
  const events = [];
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      throw new Error('request failed');
    },
    async diagnose() {
      return { state: 'error', message: 'request failed' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const runtime = {
    contextFor: () => context,
    adapterFor: () => adapter,
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  };

  assert.equal(
    await runCliProcess(
      ['chat', '--keep-browser-open', 'hello'],
      { emit: (event) => events.push(event) },
      runtime,
    ),
    1,
  );
  assert.match(events[0].message, /request failed/);
});

test('wait failure ends kept chat after emitting its response', async () => {
  const events = [];
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      return {
        text: 'answer',
        waitForClose: async () => {
          throw new Error('close wait failed');
        },
      };
    },
    async diagnose() {
      return { state: 'progress', message: 'ready' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const runtime = {
    contextFor: () => context,
    adapterFor: () => adapter,
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  };

  assert.equal(
    await runCliProcess(
      ['chat', '--keep-browser-open', 'hello'],
      { emit: (event) => events.push(event) },
      runtime,
    ),
    1,
  );
  assert.deepEqual(events.slice(0, 1), [{ speaker: 'gemini', message: 'answer' }]);
});
