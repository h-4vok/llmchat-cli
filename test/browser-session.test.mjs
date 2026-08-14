import { test } from 'node:test';
import { ensureBrowserSession } from '../dist/browser-session.js';
import assert from 'node:assert/strict';
import {
  browserSessionRequest as request,
  createBrowserSessionPorts as createPorts,
} from '../test-support/browser-session-fixture.mjs';

test('a usable persistent session resumes without browser or notification', async () => {
  const ports = createPorts('usable');
  const states = [];

  const result = await ensureBrowserSession(request, ports, (state) => states.push(state));

  assert.deepEqual(result, { status: 'ready', source: 'reused' });
  assert.deepEqual(states, [{ status: 'checking' }, { status: 'ready', source: 'reused' }]);
  assert.deepEqual(ports.calls, [['check-session', request]]);
});

test('an indeterminate probe stops without opening a login browser', async () => {
  const ports = createPorts('indeterminate');
  const states = [];

  const result = await ensureBrowserSession(request, ports, (state) => states.push(state));

  assert.deepEqual(result, { status: 'indeterminate' });
  assert.deepEqual(ports.calls, [['check-session', request]]);
  assert.deepEqual(states, [{ status: 'checking' }, { status: 'indeterminate' }]);
});

test('visible authentication waits for browser close before verifying the profile', async () => {
  const ports = createPorts('usable', ['cancelled']);
  const result = await ensureBrowserSession({ ...request, visible: true }, ports);
  assert.deepEqual(result, { status: 'ready', source: 'authenticated' });
  assert.equal(ports.calls[0][0], 'open-login-browser');
  assert.deepEqual(ports.calls[1][0], 'notify');
  assert.equal(ports.calls[2], 'close-login-browser');
  assert.deepEqual(ports.calls[3], ['check-session', { ...request, visible: false }]);
});

test('visible authentication closes after observing an authenticated session', async () => {
  const ports = createPorts('missing', ['usable']);

  const result = await ensureBrowserSession({ ...request, visible: true }, ports);

  assert.deepEqual(result, { status: 'ready', source: 'authenticated' });
  assert.equal(ports.calls.includes('close-login-browser'), true);
  assert.equal(
    ports.calls.some((call) => Array.isArray(call) && call[0] === 'check-session'),
    false,
  );
});

test('notification failure does not prevent visible authentication', async () => {
  const ports = createPorts('missing', ['usable']);
  ports.notifications.send = async () => {
    throw new Error('notification unavailable');
  };
  assert.deepEqual(await ensureBrowserSession({ ...request, visible: true }, ports), {
    status: 'ready',
    source: 'authenticated',
  });
});

test('cancelled visible authentication verifies every terminal session state', async (t) => {
  for (const availability of ['usable', 'indeterminate', 'missing']) {
    await t.test(availability, async () => {
      const ports = createPorts(availability, ['cancelled']);
      assert.deepEqual(
        await ensureBrowserSession({ ...request, visible: true }, ports),
        availability === 'usable'
          ? { status: 'ready', source: 'authenticated' }
          : { status: availability === 'indeterminate' ? 'indeterminate' : 'cancelled' },
      );
    });
  }
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
});
