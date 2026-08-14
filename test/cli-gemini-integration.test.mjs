import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import {
  geminiContext as context,
  geminiRuntimeFixture as fixture,
} from '../test-support/cli-gemini-runtime-fixture.mjs';

test('chat establishes Gemini session before adapter lookup and forwards model text', async () => {
  const { calls, runtime } = fixture();
  const events = [];

  const status = await runCliProcess(
    ['chat', 'hello', '--provider', 'gemini', '--model', 'Gemini 2.5 Pro'],
    { emit: (event) => events.push(event) },
    runtime,
  );

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    ['context', 'gemini'],
    ['session', 'gemini', context],
    ['adapter', 'gemini'],
    [
      'execute',
      {
        prompt: 'hello',
        model: 'Gemini 2.5 Pro',
        systemInstructions: undefined,
        keepBrowserOpen: false,
        disposableConversation: false,
      },
    ],
  ]);
  assert.deepEqual(events, [{ speaker: 'gemini', message: 'answer' }]);
});

test('chat preserves an explicit reasoning request', async () => {
  const { calls, runtime } = fixture();
  await runCliProcess(
    ['chat', 'hello', '--provider', 'gemini', '--reasoning', 'Standard'],
    { emit() {} },
    runtime,
  );
  assert.equal(calls.at(-1)[1].reasoning, 'Standard');
});
