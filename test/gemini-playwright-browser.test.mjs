import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightGeminiBrowser } from '../dist/gemini-playwright-browser.js';

const adapterContext = {
  profileDirectory: '/profiles/gemini',
  diagnosticsDirectory: '/diagnostics/gemini',
  screenshotsDirectory: '/screenshots/gemini',
  configuration: {},
  notify() {},
};

function page(state, navigationFailure, composerDelay = 0) {
  let currentState = state;
  let visibilityChecks = 0;
  return {
    async goto() {
      const failure = navigationFailure();
      if (failure !== undefined) throw failure;
    },
    locator(selector) {
      return {
        first() {
          return this;
        },
        async isVisible() {
          visibilityChecks += 1;
          if (selector.includes('composer') && visibilityChecks <= composerDelay) return false;
          return visibleState(selector, currentState);
        },
        async fill() {
          if (currentState === 'composer-only') currentState = 'validated';
        },
      };
    },
    url: () => 'https://gemini.google.com/app',
    isClosed: () => false,
    async waitForTimeout() {},
    async screenshot() {
      return new Uint8Array([4]);
    },
  };
}
function visibleState(selector, state) {
  if (selector.includes('send')) return state === 'ready' || state === 'validated';
  if (selector.includes('model')) return state !== 'broken';
  return state !== 'broken';
}
function fixture(initialState = 'ready', composerDelay = 0) {
  const calls = [];
  const artifacts = [];
  let navigationFailure;
  const providerPage = (state) => page(state, () => navigationFailure, composerDelay);
  const contexts = [
    {
      pages: () => [providerPage(initialState)],
      async close() {
        calls.push('close-open');
      },
    },
    {
      pages: () => [],
      async newPage() {
        calls.push('new-page');
        return providerPage('ready');
      },
      async close() {
        calls.push('close-healthy');
      },
    },
    {
      pages: () => [providerPage('broken')],
      async close() {
        calls.push('close-broken');
      },
    },
  ];
  const options = {
    platform: 'linux',
    env: {},
    chromium: {
      executablePath: () => process.execPath,
      async launchPersistentContext(profile, launchOptions) {
        calls.push(['launch', profile, launchOptions]);
        return contexts.shift();
      },
    },
    saveDiagnostic(provider, content) {
      artifacts.push(['diagnostic', provider, content]);
    },
    saveScreenshot(provider, content) {
      artifacts.push(['screenshot', provider, [...content]]);
    },
  };
  return {
    artifacts,
    browser: createPlaywrightGeminiBrowser({ send: async () => {} }, options),
    calls,
    failNavigation: (failure) => (navigationFailure = failure),
  };
}
test('real Gemini browser port uses the dedicated profile and secure artifact ports', async () => {
  const fake = fixture();
  const conversation = await fake.browser.open(adapterContext);
  await conversation.persistFailure(new Error('token=private'));
  await conversation.close();
});
test('health validates Gemini, composer, model picker, and send after text entry', async () => {
  const fake = fixture();
  await fake.browser.open(adapterContext);
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'healthy',
    message:
      'Gemini page found. Composer found. Model selector found. Send button found after text entry.',
  });
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'broken',
    message: 'Gemini UI changed: composer selector is missing.',
  });
  assert.match(fake.artifacts.at(-2)[2], /composer selector is missing/);
});
test('health waits for a composer rendered after navigation', async () => {
  const fake = fixture('ready', 2);
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'healthy',
    message:
      'Gemini page found. Composer found. Model selector found. Send button found after text entry.',
  });
});
test('unexpected health navigation failures preserve diagnostics and provider viewport', async () => {
  for (const failure of [new Error('navigation changed'), 'non-error navigation failure']) {
    const fake = fixture();
    fake.failNavigation(failure);
    await assert.rejects(fake.browser.health(adapterContext), (received) => received === failure);
    assert.ok(fake.calls.includes('close-open'));
    assert.deepEqual(
      fake.artifacts.map(([kind]) => kind),
      ['diagnostic', 'screenshot'],
    );
    assert.match(fake.artifacts[0][2], /navigation/);
  }
});
