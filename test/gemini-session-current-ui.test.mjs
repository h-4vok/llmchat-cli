import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureBrowserSession } from '../dist/browser-session.js';
import { createPersistentBrowserSessionPort } from '../dist/persistent-browser-session.js';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';

const ariaComposer = 'div[role="textbox"][aria-label="Enter a prompt for Gemini"]';
const classComposer = 'div.ql-editor.textarea.new-input-ui[contenteditable="true"]';
const accountMarker =
  'a[gem-open-account-menu][href*="accounts.google.com/SignOutOptions"][aria-label^="Google Account:"]';

function fixture(marker) {
  const calls = [];
  const artifacts = [];
  let currentMarker = marker;
  const page = {
    isClosed: () => false,
    locator: (selector) => ({
      first() {
        return this;
      },
      isVisible: async () => selector.includes(currentMarker),
    }),
    goto: async () => {},
    waitForTimeout: async (ms) => calls.push(['wait', ms]),
    url: () => 'https://gemini.google.com/app',
    screenshot: async () => new Uint8Array([9]),
  };
  const context = { pages: () => [page], close: async () => calls.push(['close']) };
  return {
    calls,
    options: {
      platform: 'linux',
      env: {},
      chromium: {
        executablePath: () => process.execPath,
        launchPersistentContext: async () => {
          calls.push(['launch']);
          return context;
        },
      },
      saveDiagnostic: (provider, content) => artifacts.push(['diagnostic', provider, content]),
      saveScreenshot: (provider, content) => artifacts.push(['screenshot', provider, [...content]]),
    },
    artifacts,
    setMarker: (value) => (currentMarker = value),
  };
}

test('launcher recognizes account and anti-bot evidence without trusting the composer', async () => {
  for (const [marker, expected] of [
    [accountMarker, 'usable'],
    [ariaComposer, 'unknown'],
    [classComposer, 'unknown'],
    ['automated queries', 'blocked'],
  ]) {
    const fake = fixture(marker);
    const window = await createPlaywrightBrowserLauncher(fake.options).open({
      provider: 'gemini',
      profileDirectory: '/profiles/gemini',
      visible: false,
    });
    assert.equal(await window.observe(), expected, marker);
    await window.close();
  }
});

test('current authenticated Gemini session does not open login or wait', async () => {
  const fake = fixture(accountMarker);
  const persistent = createPersistentBrowserSessionPort(
    createPlaywrightBrowserLauncher(fake.options),
  );
  const result = await ensureBrowserSession(
    { provider: 'gemini', profileDirectory: '/profiles/gemini' },
    {
      browser: {
        checkSession: (request) => persistent.checkSession(request),
        openLoginBrowser: async () => assert.fail('must not open login'),
      },
      notifications: { send: async () => assert.fail('must not notify') },
    },
  );
  assert.deepEqual(result, { status: 'ready', source: 'reused' });
  assert.equal(fake.calls.filter(([kind]) => kind === 'launch').length, 1);
  assert.equal(
    fake.calls.some(([kind]) => kind === 'wait'),
    false,
  );
});

test('positive login evidence is distinct from unknown authenticated UI', async () => {
  const login = fixture('button[aria-label="Sign in"]');
  let notifications = 0;
  const loginPort = createPersistentBrowserSessionPort(
    createPlaywrightBrowserLauncher(login.options),
  );
  assert.deepEqual(
    await ensureBrowserSession(
      { provider: 'gemini', profileDirectory: '/profiles/gemini' },
      {
        browser: loginPort,
        notifications: {
          async send() {
            notifications += 1;
            login.setMarker(accountMarker);
          },
        },
      },
    ),
    { status: 'ready', source: 'authenticated' },
  );
  assert.equal(notifications, 1);
  assert.equal(login.calls.filter(([kind]) => kind === 'launch').length, 2);

  const drift = fixture('selector-that-does-not-exist');
  const persistent = createPersistentBrowserSessionPort(
    createPlaywrightBrowserLauncher(drift.options),
  );
  assert.equal(
    await persistent.checkSession({ provider: 'gemini', profileDirectory: '/profiles/gemini' }),
    'indeterminate',
  );
  assert.equal(drift.calls.filter(([kind]) => kind === 'wait').length, 14);
  assert.equal(
    drift.calls.some(([kind]) => kind === 'close'),
    false,
  );
  assert.deepEqual(
    drift.artifacts.map(([kind]) => kind),
    ['diagnostic', 'screenshot'],
  );
});
