import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';

function locator(visibility) {
  return {
    first: () => ({ isVisible: async () => visibility[0] ?? false }),
    filter: ({ visible }) => locator(visibility.filter((value) => value === visible)),
  };
}

test('a hidden first sign-in match does not hide a later visible login control', async () => {
  const page = {
    isClosed: () => false,
    goto: async () => {},
    url: () => 'https://gemini.google.com/app',
    locator: (selector) => locator(selector.includes('^Sign in') ? [false, true] : [false]),
  };
  const window = await createPlaywrightBrowserLauncher({
    platform: 'linux',
    env: {},
    chromium: {
      executablePath: () => process.execPath,
      launchPersistentContext: async () => ({ pages: () => [page], close: async () => {} }),
    },
  }).open({ provider: 'gemini', profileDirectory: '/isolated/fake/profile', visible: false });
  assert.equal(await window.observe(), 'login-required');
});
