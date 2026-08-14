import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import { messages } from '../dist/config/messages.js';
import {
  geminiContext as context,
  geminiRuntimeFixture as fixture,
} from '../test-support/cli-gemini-runtime-fixture.mjs';

test('auth and health validate command shape and health failures', async () => {
  const invalid = [];
  assert.equal(await runCliProcess(['auth'], { emit: (event) => invalid.push(event) }), 1);
  assert.equal(await runCliProcess(['health'], { emit: (event) => invalid.push(event) }), 1);
  assert.match(invalid[0].message, /auth <provider>/);
  assert.match(invalid[1].message, /health <provider>/);
  const { runtime } = fixture(undefined, { status: 'broken', message: 'selectors changed' });
  const events = [];
  assert.equal(
    await runCliProcess(['health', 'gemini'], { emit: (event) => events.push(event) }, runtime),
    1,
  );
  assert.match(events.at(-1).message, /selectors changed/);
});

test('legacy injected runtimes can still run auth and health without a session boundary', async () => {
  const { runtime } = fixture();
  delete runtime.ensureSession;
  assert.equal(await runCliProcess(['auth', 'gemini'], { emit() {} }, runtime), 0);
  assert.equal(await runCliProcess(['health', 'gemini'], { emit() {} }, runtime), 0);
});

test('auth gemini runs the same session preparation without obtaining an adapter', async () => {
  const { calls, runtime } = fixture();
  const events = [];
  assert.equal(
    await runCliProcess(['auth', 'gemini'], { emit: (event) => events.push(event) }, runtime),
    0,
  );
  assert.deepEqual(calls, [
    ['context', 'gemini'],
    ['session', 'gemini', context],
  ]);
  assert.deepEqual(events, [{ speaker: 'llmchat', message: messages.auth.sessionReused }]);
});

test('auth reports when Gemini authentication completed', async () => {
  const { runtime } = fixture({ status: 'ready', source: 'authenticated' });
  const events = [];
  assert.equal(
    await runCliProcess(['auth', 'gemini'], { emit: (event) => events.push(event) }, runtime),
    0,
  );
  assert.deepEqual(events, [{ speaker: 'llmchat', message: messages.auth.sessionAuthenticated }]);
});

test('health gemini checks required UI without sending a prompt', async () => {
  const { calls, runtime } = fixture();
  const events = [];
  assert.equal(
    await runCliProcess(['health', 'gemini'], { emit: (event) => events.push(event) }, runtime),
    0,
  );
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['context', 'adapter', 'health'],
  );
  assert.deepEqual(events, [{ speaker: 'llmchat', message: 'ready' }]);
});

test('explicit authentication cancellation stops chat safely', async () => {
  const { calls, runtime } = fixture({ status: 'cancelled' });
  const events = [];
  assert.equal(
    await runCliProcess(
      ['chat', 'hello', '--provider', 'gemini'],
      { emit: (event) => events.push(event) },
      runtime,
    ),
    1,
  );
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['context', 'session'],
  );
  assert.match(events[0].message, /cancelled/i);
});

test('auth reports explicit authentication cancellation', async () => {
  const { runtime } = fixture({ status: 'cancelled' });
  const events = [];
  assert.equal(
    await runCliProcess(['auth', 'gemini'], { emit: (event) => events.push(event) }, runtime),
    1,
  );
  assert.match(events.at(-1).message, /cancelled/i);
});
