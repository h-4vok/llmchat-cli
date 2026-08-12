import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPersistentBrowserSessionPort } from '../dist/persistent-browser-session.js';

function launcher(...observations) {
  const calls = [];
  const failures = [];
  let closed = 0;
  return {
    calls,
    closed: () => closed,
    failures,
    port: {
      async open(request) {
        calls.push(request);
        let index = 0;
        return {
          async observe() {
            return observations[Math.min(index++, observations.length - 1)];
          },
          async wait() {},
          async persistFailure(error) {
            failures.push(error.message);
          },
          async close() {
            closed += 1;
          },
        };
      },
    },
  };
}

const request = { provider: 'gemini', profileDirectory: '/profiles/gemini' };

test('session probing uses the dedicated profile and closes its hidden browser', async () => {
  const fake = launcher('usable');
  const port = createPersistentBrowserSessionPort(fake.port);

  assert.equal(await port.checkSession(request), 'usable');
  assert.deepEqual(fake.calls, [{ ...request, visible: false }]);
  assert.equal(fake.closed(), 1);
});

test('non-usable probes report a missing session', async () => {
  const fake = launcher('login-required');
  const port = createPersistentBrowserSessionPort(fake.port);
  assert.equal(await port.checkSession(request), 'missing');
});

test('visible login observation terminates on explicit browser cancellation', async () => {
  const fake = launcher('cancelled');
  const login = await createPersistentBrowserSessionPort(fake.port).openLoginBrowser({
    ...request,
    visible: true,
  });
  const seen = [];
  for await (const state of login.observeSession()) seen.push(state);
  assert.deepEqual(seen, ['cancelled']);
});

test('visible login observation preserves verification until usable', async () => {
  const fake = launcher('captcha', 'blocked', 'usable');
  const port = createPersistentBrowserSessionPort(fake.port);
  const login = await port.openLoginBrowser({ ...request, visible: true });
  const seen = [];

  for await (const state of login.observeSession()) seen.push(state);

  assert.deepEqual(seen, ['captcha', 'blocked', 'usable']);
  assert.equal(fake.closed(), 0);
  await login.close();
  assert.equal(fake.closed(), 1);
});

test('unknown UI during visible login persists failure and preserves the browser', async () => {
  const fake = launcher('unknown');
  const login = await createPersistentBrowserSessionPort(fake.port).openLoginBrowser({
    ...request,
    visible: true,
  });

  const seen = [];
  for await (const state of login.observeSession()) seen.push(state);
  assert.deepEqual(seen, ['indeterminate']);
  await login.close();
  assert.equal(fake.closed(), 0);
  assert.deepEqual(fake.failures, [
    'Gemini UI changed: unable to determine authenticated session state.',
  ]);
});
