import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import { createGeminiAdapter } from '../dist/gemini-adapter.js';
import { createGeminiPlaywrightPage } from '../dist/gemini-playwright-page.js';

const context = {
  profileDirectory: 'profiles/gemini',
  diagnosticsDirectory: 'diagnostics/gemini',
  screenshotsDirectory: 'screenshots/gemini',
  configuration: {},
  notify() {},
};

test('chat emits before waiting for the kept browser to close', async () => {
  let release;
  const waiting = new Promise((resolve) => (release = resolve));
  const events = [];
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      return { text: 'answer', waitForClose: () => waiting };
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
    ensureSession: async () => ({ status: 'ready', source: 'reused' }),
    adapterFor: () => adapter,
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  };

  const command = runCliProcess(
    ['chat', '--keep-browser-open', 'hello'],
    { emit: (event) => events.push(event) },
    runtime,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ speaker: 'gemini', message: 'answer' }]);
  release();
  assert.equal(await command, 0);
});

test('Gemini adapter keeps the conversation and exposes its close wait', async () => {
  let closed = false;
  const conversation = {
    async submit(_request, emit) {
      emit({ kind: 'response', text: 'answer' });
    },
    async diagnoseLocally() {
      return { state: 'ready', message: 'ready' };
    },
    async persistFailure() {},
    async close() {
      closed = true;
    },
    async waitForClose() {
      return undefined;
    },
  };
  const adapter = createGeminiAdapter({
    browser: {
      open: async () => conversation,
      health: async () => ({ status: 'healthy', message: 'ready' }),
    },
    inactivityMs: 10,
  });
  const response = await adapter.executeChat({ prompt: 'hello', keepBrowserOpen: true }, context);

  assert.equal(closed, false);
  await response.waitForClose();
});

test('Playwright page close waiting resolves when the page is already closed', async () => {
  const page = createGeminiPlaywrightPage({ isClosed: () => true }, {});
  await page.waitForClose();
});

test('Playwright page close waiting polls until the page closes', async () => {
  let closed = false;
  const page = createGeminiPlaywrightPage(
    {
      isClosed: () => closed,
      waitForTimeout: async () => {
        closed = true;
      },
    },
    {},
  );
  await page.waitForClose();
});

test('Playwright page close waiting propagates errors while the page remains open', async () => {
  const failure = new Error('wait failed');
  const page = createGeminiPlaywrightPage(
    {
      isClosed: () => false,
      waitForTimeout: async () => {
        throw failure;
      },
    },
    {},
  );
  await assert.rejects(page.waitForClose(), failure);
});
