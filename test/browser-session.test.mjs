import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureBrowserSession } from '../dist/browser-session.js';

const request = {
  provider: 'gemini',
  profileDirectory: 'C:\\llmchat\\profiles\\gemini',
};

function createPorts(sessionStatus, observations = []) {
  const calls = [];
  let closeCalls = 0;
  const loginBrowser = {
    async *observeSession() {
      for (const observation of observations) {
        assert.equal(closeCalls, 0);
        yield await observation;
      }
    },
    async close() {
      closeCalls += 1;
      calls.push('close-login-browser');
    },
  };
  return {
    calls,
    closeCalls: () => closeCalls,
    browser: {
      async checkSession(received) {
        calls.push(['check-session', received]);
        return sessionStatus;
      },
      async openLoginBrowser(received) {
        calls.push(['open-login-browser', received]);
        return loginBrowser;
      },
    },
    notifications: {
      async send(notification) {
        calls.push(['notify', notification]);
      },
    },
  };
}

test('a usable persistent session resumes without browser or notification', async () => {
  const ports = createPorts('usable');
  const states = [];

  const result = await ensureBrowserSession(request, ports, (state) => states.push(state));

  assert.deepEqual(result, { status: 'ready', source: 'reused' });
  assert.deepEqual(states, [{ status: 'checking' }, { status: 'ready', source: 'reused' }]);
  assert.deepEqual(ports.calls, [['check-session', request]]);
});

test('an indeterminate probe opens one visible login browser and notifies once', async () => {
  const ports = createPorts('indeterminate', ['usable']);
  const states = [];

  const result = await ensureBrowserSession(request, ports, (state) => states.push(state));

  assert.deepEqual(result, { status: 'ready', source: 'authenticated' });
  assert.equal(ports.calls.filter((call) => Array.isArray(call) && call[0] === 'notify').length, 1);
  assert.deepEqual(states, [
    { status: 'checking' },
    { status: 'attention-required', reason: 'login' },
    { status: 'ready', source: 'authenticated' },
  ]);
});

test('missing or expired sessions wait through manual intervention then resume', async (t) => {
  for (const unavailable of ['missing', 'expired']) {
    await t.test(unavailable, async () => {
      const ports = createPorts(unavailable, ['captcha', 'blocked', 'usable']);
      const states = [];

      const result = await ensureBrowserSession(request, ports, (state) => states.push(state));

      assert.deepEqual(result, { status: 'ready', source: 'authenticated' });
      assert.equal(ports.closeCalls(), 1);
      assert.deepEqual(ports.calls, [
        ['check-session', request],
        ['open-login-browser', { ...request, visible: true }],
        [
          'notify',
          {
            kind: 'authentication-attention',
            provider: 'gemini',
            title: 'Authentication required',
            message: 'gemini needs your attention to sign in.',
          },
        ],
        'close-login-browser',
      ]);
      assert.deepEqual(states, [
        { status: 'checking' },
        { status: 'attention-required', reason: 'login' },
        { status: 'attention-required', reason: 'captcha' },
        { status: 'attention-required', reason: 'blocked' },
        { status: 'ready', source: 'authenticated' },
      ]);
    });
  }
});

test('explicit cancellation closes only the login browser and does not resume', async () => {
  const ports = createPorts('missing', ['cancelled']);

  const result = await ensureBrowserSession(request, ports);

  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(ports.closeCalls(), 1);
});

test('an interrupted observation stream closes its login browser', async () => {
  const ports = createPorts('missing');

  await assert.rejects(
    ensureBrowserSession(request, ports),
    /stopped before authentication or cancellation/,
  );
  assert.equal(ports.closeCalls(), 1);
});

test('login has no timeout and stays open until a terminal observation', async () => {
  let release;
  const terminalObservation = new Promise((resolve) => {
    release = resolve;
  });
  const ports = createPorts('missing', [terminalObservation]);
  let settled = false;

  const execution = ensureBrowserSession(request, ports).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  assert.equal(ports.closeCalls(), 0);
  release('usable');
  assert.deepEqual(await execution, { status: 'ready', source: 'authenticated' });
});

test('independent executions do not reuse in-memory session state', async () => {
  const first = createPorts('missing', ['usable']);
  const second = createPorts('missing', ['usable']);

  await Promise.all([ensureBrowserSession(request, first), ensureBrowserSession(request, second)]);

  assert.equal(first.calls.filter((call) => Array.isArray(call) && call[0] === 'notify').length, 1);
  assert.equal(
    second.calls.filter((call) => Array.isArray(call) && call[0] === 'notify').length,
    1,
  );
});
