import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLazyNotificationPort, createRealChatRuntime } from '../dist/real-chat-runtime.js';
import { stableProfileAllocator } from '../test-support/stable-profile-allocator.mjs';

const paths = {
  profileDirectory: '/profiles/gemini',
  diagnosticsDirectory: '/diagnostics/gemini',
  screenshotsDirectory: '/screenshots/gemini',
};

test('real runtime connects normalized login and blocked diagnostics before Gemini use', async () => {
  let releaseNotification;
  let releaseVerification;
  const notification = new Promise((resolve) => (releaseNotification = resolve));
  const verification = new Promise((resolve) => (releaseVerification = resolve));
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      return { text: 'unused' };
    },
    async diagnose() {
      return { state: 'progress', message: 'adapter ready' };
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
          return 'missing';
        },
        async openLoginBrowser() {
          return {
            async *observeSession() {
              yield 'captcha';
              await verification;
              yield 'usable';
            },
            async close() {},
          };
        },
      },
      notifications: { send: async () => notification },
    },
  });
  const context = runtime.contextFor('gemini');
  const pending = runtime.ensureSession('gemini', context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(await runtime.adapterFor('gemini').diagnose(context), {
    state: 'session-required',
    message: 'Manual Gemini sign-in is required.',
  });
  releaseNotification();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await runtime.adapterFor('gemini').diagnose(context), {
    state: 'blocked',
    message: 'Gemini requires manual intervention (captcha).',
  });
  releaseVerification();
  await pending;
  assert.deepEqual(await runtime.adapterFor('gemini').diagnose(context), {
    state: 'progress',
    message: 'adapter ready',
  });
});

test('real runtime delegates adapter operations and keeps native notifications lazy', async () => {
  const calls = [];
  const adapter = {
    provider: 'gemini',
    async executeChat(request) {
      calls.push(['execute', request]);
      return { text: 'done' };
    },
    async diagnose() {
      return { state: 'progress', message: 'ready' };
    },
    async checkHealth() {
      calls.push(['health']);
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
    timeout: { timeoutMs: 7 },
  });
  const context = runtime.contextFor('gemini');
  context.notify({ kind: 'progress', message: 'ignored' });
  const wrapped = runtime.adapterFor('gemini');
  assert.deepEqual(await wrapped.executeChat({ prompt: 'hello' }, context), { text: 'done' });
  assert.deepEqual(await wrapped.checkHealth(context), {
    status: 'healthy',
    message: 'ready',
  });
  assert.deepEqual(runtime.timeout, { timeoutMs: 7 });

  let factories = 0;
  const notifications = [];
  const lazy = createLazyNotificationPort(() => {
    factories += 1;
    return {
      async send(value) {
        notifications.push(value);
      },
    };
  });
  assert.equal(factories, 0);
  await lazy.send({
    kind: 'authentication-attention',
    provider: 'gemini',
    title: 'a',
    message: 'b',
  });
  assert.equal(factories, 1);
  assert.equal(notifications.length, 1);
  assert.doesNotThrow(() => createLazyNotificationPort());
});

test('real runtime accepts an injected diagnostic recorder', () => {
  const recordChat = () => {};
  const runtime = createRealChatRuntime({
    provisionStorage: () => paths,
    recordChat,
  });

  assert.equal(runtime.recordChat, recordChat);
});
