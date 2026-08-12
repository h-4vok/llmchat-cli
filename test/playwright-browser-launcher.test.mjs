import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';
function fixture(useExistingPage = false) {
  const calls = [];
  let state = 'login';
  let closed = false;
  let rejectVisibility = false;
  let currentUrl = 'https://gemini.google.com/app';
  const page = {
    isClosed: () => closed,
    locator(selector) {
      return {
        first() {
          return this;
        },
        async isVisible() {
          if (rejectVisibility) throw new Error('detached');
          return visibleForState(selector, state);
        },
      };
    },
    async goto(url) {
      calls.push(['goto', url]);
    },
    async waitForTimeout(ms) {
      calls.push(['wait', ms]);
    },
    url: () => currentUrl,
  };
  const context = {
    pages: () => (useExistingPage ? [page] : []),
    async newPage() {
      calls.push(['new-page']);
      return page;
    },
    async close() {
      calls.push(['close']);
    },
  };
  const options = {
    platform: 'linux',
    env: {},
    chromium: {
      executablePath: () => process.execPath,
      async launchPersistentContext(profile, launchOptions) {
        calls.push(['launch', profile, launchOptions]);
        return context;
      },
    },
  };
  return {
    calls,
    options,
    setState: (value) => (state = value),
    setClosed: (value) => (closed = value),
    rejectVisibility: () => (rejectVisibility = true),
    setUrl: (value) => (currentUrl = value),
  };
}
function visibleForState(selector, state) {
  if (isLoginEvidence(selector, state)) return true;
  return selector.includes(authenticatedMarker(state)) || selector.includes(stateMarker(state));
}
function authenticatedMarker(state) {
  return state === 'usable' ? 'Google Account' : '\0';
}
function stateMarker(state) {
  const markers = {
    login: 'Sign in',
    captcha: 'recaptcha',
    blocked: 'unusual traffic',
    usable: 'rich-textarea',
    'unauthenticated-composer': 'rich-textarea',
  };
  return markers[state] ?? '\0';
}
function isLoginEvidence(selector, state) {
  return (
    state === 'unauthenticated-composer' &&
    (selector.includes('ServiceLogin') ||
      selector.includes('Sign in') ||
      selector.includes('^Sign in'))
  );
}
test('Playwright launcher opens the dedicated profile and normalizes provider states', async () => {
  const fake = fixture();
  const launcher = createPlaywrightBrowserLauncher(fake.options);
  const window = await launcher.open({
    provider: 'gemini',
    profileDirectory: '/profiles/gemini',
    visible: false,
  });
  assert.equal(await window.observe(), 'login-required');
  for (const state of ['captcha', 'blocked', 'usable']) {
    fake.setState(state);
    assert.equal(await window.observe(), state);
  }
  fake.rejectVisibility();
  fake.setUrl('https://accounts.google.com/ServiceLogin');
  assert.equal(await window.observe(), 'login-required');
  fake.setUrl('https://gemini.google.com/app');
  assert.equal(await window.observe(), 'unknown');
  fake.setClosed(true);
  assert.equal(await window.observe(), 'cancelled');
  await window.wait();
  await window.close();
  assert.deepEqual(fake.calls[0], [
    'launch',
    '/profiles/gemini',
    {
      executablePath: process.execPath,
      headless: true,
      timeout: 15_000,
      ignoreDefaultArgs: ['--no-sandbox'],
      args: ['--disable-blink-features=AutomationControlled'],
    },
  ]);
  assert.ok(fake.calls.some(([kind]) => kind === 'new-page'));
});
test('Playwright launcher reuses an existing page, supports hidden probes, and rejects providers', async () => {
  const fake = fixture(true);
  const launcher = createPlaywrightBrowserLauncher(fake.options);
  const window = await launcher.open({
    provider: 'gemini',
    profileDirectory: '/profiles/gemini',
    visible: false,
  });
  await window.close();
  assert.equal(
    fake.calls.some(([kind]) => kind === 'new-page'),
    false,
  );
  assert.equal(fake.calls[0][2].headless, true);
  await assert.rejects(
    launcher.open({ provider: 'unknown', profileDirectory: '/profiles/x', visible: true }),
    /No browser login URL/,
  );
});
test('visible composer alone never proves authentication', async () => {
  const fake = fixture(true);
  fake.setState('unauthenticated-composer');
  const launcher = createPlaywrightBrowserLauncher(fake.options);
  const window = await launcher.open({
    provider: 'gemini',
    profileDirectory: '/profiles/gemini',
    visible: true,
  });
  assert.equal(await window.observe(), 'login-required');
});
