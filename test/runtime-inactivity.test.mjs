import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import { createRealChatRuntime } from '../dist/real-chat-runtime.js';
import { stableProfileAllocator } from '../test-support/stable-profile-allocator.mjs';

const paths = {
  profileDirectory: '/profiles/gemini',
  diagnosticsDirectory: '/diagnostics/gemini',
  screenshotsDirectory: '/screenshots/gemini',
};

function manualTimeout() {
  const timers = [];
  return {
    timers,
    options: {
      timeoutMs: 10,
      schedule(expire, timeoutMs) {
        const timer = { cancelled: false, expire, timeoutMs };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
  };
}

function fixture(timeout) {
  let resolveResponse = () => {};
  let executionContext;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const adapter = {
    provider: 'gemini',
    executeChat(_request, context) {
      executionContext = context;
      return response;
    },
    async diagnose() {
      return { state: 'error', message: 'no observable Gemini activity' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const runtime = createRealChatRuntime({
    profileAllocator: stableProfileAllocator,
    provisionStorage: () => paths,
    adapter,
    sessionPorts: {
      browser: {
        async checkSession() {
          return 'usable';
        },
        async openLoginBrowser() {
          throw new Error('unused');
        },
      },
      notifications: { async send() {} },
    },
    timeout: timeout.options,
  });
  return {
    runtime,
    context: () => executionContext,
    resolve: (text) => resolveResponse({ text }),
  };
}

test('runtime activity rearms CLI inactivity beyond the previous deadline', async () => {
  const timeout = manualTimeout();
  const session = fixture(timeout);
  const execution = runCliProcess(
    ['chat', 'hello', '--provider', 'gemini'],
    { emit() {} },
    session.runtime,
  );
  await new Promise((resolve) => setImmediate(resolve));

  session.context().notify({ kind: 'progress', message: 'composing' });
  assert.equal(timeout.timers.length, 2);
  timeout.timers[0].expire();
  session.context().notify({ kind: 'progress', message: 'still composing' });
  assert.equal(timeout.timers.length, 3);
  timeout.timers[1].expire();
  session.resolve('done after sustained activity');

  assert.equal(await execution, 0);
  assert.equal(timeout.timers[2].cancelled, true);
});

test('runtime inactivity without activity still fails once with local diagnosis', async () => {
  const timeout = manualTimeout();
  const session = fixture(timeout);
  const events = [];
  const execution = runCliProcess(
    ['chat', 'hello', '--provider', 'gemini'],
    { emit: (event) => events.push(event) },
    session.runtime,
  );
  await new Promise((resolve) => setImmediate(resolve));

  timeout.timers[0].expire();

  assert.equal(await execution, 1);
  assert.match(events[0].message, /no observable Gemini activity/);
  assert.equal(timeout.timers.length, 1);
});
