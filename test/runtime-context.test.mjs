import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withRuntimeContext } from '../dist/runtime-context.js';

const context = { profileDirectory: '/profiles/gemini' };

test('runtime context releases its profile lease after a failed command', async () => {
  let released = 0;
  const runtime = {
    contextFor: () => context,
    releaseContext: (received) => {
      assert.equal(received, context);
      released += 1;
    },
  };

  await assert.rejects(
    withRuntimeContext(runtime, 'gemini', async () => {
      throw new Error('Brave was closed');
    }),
    /Brave was closed/,
  );
  assert.equal(released, 1);
});
