import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureBrowserSession } from '../dist/browser-session.js';

const request = { provider: 'gemini', profileDirectory: 'profiles/gemini', visible: true };

function ports(close) {
  let checked = false;
  return {
    checked: () => checked,
    browser: {
      async checkSession() {
        checked = true;
        return 'usable';
      },
      async openLoginBrowser() {
        return {
          async *observeSession() {
            yield 'cancelled';
          },
          close,
        };
      },
    },
    notifications: { async send() {} },
  };
}

test('closed visible context finishes before its hidden verification probe', async () => {
  let releaseClose;
  const closed = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const fake = ports(async () => closed);
  const execution = ensureBrowserSession(request, fake);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.checked(), false);
  releaseClose();
  assert.deepEqual(await execution, { status: 'ready', source: 'authenticated' });
  assert.equal(fake.checked(), true);
});

test('visible context close failure prevents its hidden verification probe', async () => {
  const fake = ports(async () => {
    throw new Error('context close failed');
  });

  await assert.rejects(ensureBrowserSession(request, fake), /context close failed/);
  assert.equal(fake.checked(), false);
});
