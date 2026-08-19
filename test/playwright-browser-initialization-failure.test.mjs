import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';

test('failed browser initialization closes the acquired context and preserves the failure', async (t) => {
  for (const scenario of [
    { name: 'page preparation', useExistingPage: false },
    { name: 'initial navigation', useExistingPage: true },
  ]) {
    await t.test(scenario.name, async () => {
      const failure = new Error(`${scenario.name} failed`);
      let closes = 0;
      const page = { goto: async () => Promise.reject(failure) };
      const context = {
        pages: () => (scenario.useExistingPage ? [page] : []),
        newPage: async () => Promise.reject(failure),
        async close() {
          closes += 1;
          throw new Error('cleanup failed');
        },
      };
      const launcher = createPlaywrightBrowserLauncher({
        platform: 'linux',
        env: {},
        chromium: {
          executablePath: () => process.execPath,
          launchPersistentContext: async () => context,
        },
      });

      await assert.rejects(
        launcher.open({ provider: 'gemini', profileDirectory: '/profiles/gemini', visible: true }),
        failure,
      );
      assert.equal(closes, 1);
    });
  }
});
