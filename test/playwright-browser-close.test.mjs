import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';

test('launcher propagates persistent context close failure', async () => {
  const failure = new Error('context close failed');
  const page = { async goto() {} };
  const context = {
    pages: () => [page],
    async close() {
      throw failure;
    },
  };
  const launcher = createPlaywrightBrowserLauncher({
    platform: 'linux',
    env: {},
    chromium: {
      executablePath: () => process.execPath,
      async launchPersistentContext() {
        return context;
      },
    },
  });

  const window = await launcher.open({
    provider: 'gemini',
    profileDirectory: '/profiles/gemini',
    visible: true,
  });

  await assert.rejects(window.close(), failure);
});
