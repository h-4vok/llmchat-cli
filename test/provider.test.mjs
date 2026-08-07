import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendChat } from '../dist/provider.js';

test('provider adapter forwards the opaque system-instructions name unchanged', () => {
  const name = 'My Assistant / v2';
  assert.equal(
    sendChat('gemini', { prompt: 'hello', systemInstructions: name }),
    'Simulated response from gemini using system instructions "My Assistant / v2": hello',
  );
});

test('provider adapter reports unresolved system instructions without fallback', () => {
  assert.throws(
    () => sendChat('gemini', { prompt: 'hello', systemInstructions: 'unresolvable' }),
    /Provider gemini could not resolve system instructions "unresolvable"\./,
  );
});
