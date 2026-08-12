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

function page(state, navigationFailure) {
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
          if (selector.includes('send')) return state === 'ready';
          return state === 'ready' || state === 'composer-only';
        },
      };
    },
    url: () => 'https://gemini.google.com/app',
    async screenshot() {
      return new Uint8Array([4]);
    },
  };
}

function fixture() {
  const calls = [];
  const artifacts = [];
  let navigationFailure;
  const providerPage = (state) => page(state, () => navigationFailure);
  const contexts = [
    {
      pages: () => [providerPage('ready')],
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
      pages: () => [providerPage('composer-only')],
      async close() {
        calls.push('close-degraded');
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
  assert.deepEqual(
    fake.artifacts.map(([kind, provider]) => [kind, provider]),
    [
      ['diagnostic', 'gemini'],
      ['screenshot', 'gemini'],
    ],
  );
  assert.match(fake.artifacts[0][2], /token=\[REDACTED\]/);
  assert.deepEqual(fake.calls[0], [
    'launch',
    '/profiles/gemini',
    { executablePath: process.execPath, headless: false },
  ]);
});

test('health reports deferred send capability and preserves real composer failures', async () => {
  const fake = fixture();
  await fake.browser.open(adapterContext);
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'healthy',
    message: 'Gemini UI selectors are ready.',
  });
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'degraded',
    message: 'Gemini composer is ready; send appears after text entry and was not validated.',
  });
  assert.ok(fake.calls.includes('close-degraded'));
  assert.equal(fake.artifacts.length, 0);
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'broken',
    message: 'Gemini UI changed: composer selector is missing.',
  });
  assert.ok(fake.calls.includes('new-page'));
  assert.ok(fake.calls.includes('close-healthy'));
  assert.equal(fake.calls.includes('close-broken'), false);
  assert.deepEqual(
    fake.artifacts.slice(-2).map(([kind]) => kind),
    ['diagnostic', 'screenshot'],
  );
  assert.match(fake.artifacts.at(-2)[2], /composer selector is missing/);
});

test('unexpected health navigation failures preserve diagnostics and provider viewport', async () => {
  for (const failure of [new Error('navigation changed'), 'non-error navigation failure']) {
    const fake = fixture();
    fake.failNavigation(failure);
    await assert.rejects(fake.browser.health(adapterContext), (received) => received === failure);
    assert.equal(fake.calls.includes('close-open'), false);
    assert.deepEqual(
      fake.artifacts.map(([kind]) => kind),
      ['diagnostic', 'screenshot'],
    );
    assert.match(fake.artifacts[0][2], /navigation/);
  }
});
