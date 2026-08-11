import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorMessage } from '../dist/error-format.js';

test('errorMessage formats Error instances', () => {
  assert.equal(errorMessage(new Error('failed')), '[error] failed');
});

test('errorMessage formats non-Error failures', () => {
  assert.equal(errorMessage('failed'), '[error] failed');
});
