import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticationAttention } from '../dist/native-notification.js';

test('authentication attention identifies the provider without exposing session data', () => {
  assert.deepEqual(authenticationAttention('gemini'), {
    kind: 'authentication-attention',
    provider: 'gemini',
    title: 'Authentication required',
    message: 'gemini needs your attention to sign in.',
  });
});
