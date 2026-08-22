import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealChatRuntime } from '../dist/real-chat-runtime.js';
import { stableProfileAllocator } from '../test-support/stable-profile-allocator.mjs';

for (const [availability, expected] of [
  ['missing', { status: 'authentication-required' }],
  ['usable', { status: 'ready', source: 'reused' }],
  ['indeterminate', { status: 'indeterminate' }],
]) {
  test(`non-interactive ${availability} session never opens authentication`, async () => {
    let opened = 0;
    const runtime = runtimeFor(availability, () => {
      opened += 1;
    });
    const context = runtime.contextFor('gemini');

    const result = await runtime.ensureSession('gemini', context, { interactive: false });

    assert.deepEqual(result, expected);
    assert.equal(opened, 0);
  });
}

function runtimeFor(availability, onOpen) {
  return createRealChatRuntime({
    profileAllocator: stableProfileAllocator,
    provisionStorage: () => ({
      profileDirectory: '/profiles/gemini',
      diagnosticsDirectory: '/diagnostics/gemini',
      screenshotsDirectory: '/screenshots/gemini',
    }),
    sessionPorts: {
      browser: {
        checkSession: async () => availability,
        async openLoginBrowser() {
          onOpen();
          throw new Error('must not open');
        },
      },
      notifications: { async send() {} },
    },
  });
}
