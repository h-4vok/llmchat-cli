import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnosticForBrowserSession } from '../dist/browser-session-diagnostic.js';

test('login and verification states use normalized diagnostics', () => {
  assert.deepEqual(
    diagnosticForBrowserSession({ status: 'attention-required', reason: 'login' }, 'gemini'),
    { state: 'session-required', message: 'Manual Gemini sign-in is required.' },
  );
  for (const reason of ['captcha', 'blocked']) {
    assert.deepEqual(
      diagnosticForBrowserSession({ status: 'attention-required', reason }, 'gemini'),
      { state: 'blocked', message: `Gemini requires manual intervention (${reason}).` },
    );
  }
  assert.deepEqual(diagnosticForBrowserSession({ status: 'cancelled' }, 'gemini'), {
    state: 'error',
    message: 'Gemini sign-in was cancelled.',
  });
  assert.deepEqual(diagnosticForBrowserSession({ status: 'checking' }, 'gemini'), {
    state: 'progress',
    message: 'Gemini session checking.',
  });
});
