import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import { messages } from '../dist/config/messages.js';

const context = {
  profileDirectory: 'profiles/gemini',
  diagnosticsDirectory: 'diagnostics/gemini',
  screenshotsDirectory: 'screenshots/gemini',
  configuration: {},
  notify() {},
};

function fixture(
  session = { status: 'ready', source: 'reused' },
  health = { status: 'healthy', message: 'ready' },
) {
  const calls = [];
  const adapter = {
    provider: 'gemini',
    async executeChat(request) {
      calls.push(['execute', request]);
      return { text: 'answer' };
    },
    async diagnose() {
      return { state: 'progress', message: 'ready' };
    },
    async checkHealth() {
      calls.push(['health']);
      return health;
    },
  };
  return {
    calls,
    runtime: {
      contextFor(provider) {
        calls.push(['context', provider]);
        return context;
      },
      async ensureSession(provider, received) {
        calls.push(['session', provider, received]);
        return session;
      },
      adapterFor(provider) {
        calls.push(['adapter', provider]);
        return adapter;
      },
      timeout: { timeoutMs: 10, schedule: () => () => {} },
    },
  };
}

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

test('auth and health validate command shape and health failures', async () => {
  const invalid = [];
  assert.equal(await runCliProcess(['auth'], { emit: (event) => invalid.push(event) }), 1);
  assert.equal(await runCliProcess(['health'], { emit: (event) => invalid.push(event) }), 1);
  assert.match(invalid[0].message, /auth <provider>/);
  assert.match(invalid[1].message, /health <provider>/);

  const { runtime } = fixture(
    { status: 'ready', source: 'reused' },
    { status: 'broken', message: 'selectors changed' },
  );
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
