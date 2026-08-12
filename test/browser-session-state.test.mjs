import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionBrowserSession } from '../dist/browser-session.js';

test('session events form provider-neutral observable states', () => {
  const checking = { status: 'checking' };

  assert.deepEqual(transitionBrowserSession(checking, { type: 'session-reused' }), {
    status: 'ready',
    source: 'reused',
  });
  assert.deepEqual(transitionBrowserSession(checking, { type: 'session-required' }), {
    status: 'attention-required',
    reason: 'login',
  });
  assert.deepEqual(
    transitionBrowserSession(checking, { type: 'login-observed', observation: 'captcha' }),
    { status: 'attention-required', reason: 'captcha' },
  );
  assert.deepEqual(
    transitionBrowserSession(checking, { type: 'login-observed', observation: 'blocked' }),
    { status: 'attention-required', reason: 'blocked' },
  );
  assert.deepEqual(
    transitionBrowserSession(checking, { type: 'login-observed', observation: 'usable' }),
    { status: 'ready', source: 'authenticated' },
  );
  assert.deepEqual(
    transitionBrowserSession(checking, { type: 'login-observed', observation: 'cancelled' }),
    { status: 'cancelled' },
  );
});
