import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';

test('visible unknown Gemini UI remains indeterminate', async () => {
  const page = {
    isClosed: () => false,
    locator: () => ({
      first() {
        return this;
      },
      isVisible: async () => false,
    }),
    async goto() {},
    url: () => 'https://gemini.google.com/app',
  };
  const context = { pages: () => [page], async close() {} };
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

  assert.equal(await window.observe(), 'unknown');
});
