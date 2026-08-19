import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatRuntime } from '../dist/chat-runtime.js';
import { runCliProcess } from '../dist/cli-app.js';

const context = {
  profileDirectory: 'profiles/gemini',
  diagnosticsDirectory: 'diagnostics/gemini',
  configuration: {},
  notify() {},
};

function outputEvents() {
  const events = [];
  return { events, output: { emit: (event) => events.push(event) } };
}

function timeoutDependencies(state) {
  let expire = () => {};
  const adapter = {
    provider: 'gemini',
    async executeChat(_request, _context, signal) {
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
    async diagnose() {
      return { state, message: `diagnostic ${state} token=diagnostic-secret&safe=visible` };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  return {
    dependencies: {
      adapterFor: () => adapter,
      contextFor: () => context,
      timeout: {
        timeoutMs: 10,
        schedule(callback) {
          expire = callback;
          return () => {};
        },
      },
    },
    expire: () => expire(),
  };
}

test('CLI timeout emits every normalized adapter diagnostic as a failure', async (t) => {
  for (const state of ['progress', 'error', 'blocked', 'session-required']) {
    await t.test(state, async () => {
      const { events, output } = outputEvents();
      const runtime = timeoutDependencies(state);
      const execution = runCliProcess(
        ['chat', '--provider', 'gemini', 'hello'],
        output,
        runtime.dependencies,
      );

      runtime.expire();

      assert.equal(await execution, 1);
      assert.deepEqual(events, [
        {
          speaker: 'llmchat',
          tone: 'error',
          message: `[error] Adapter timed out (${state}): diagnostic ${state} token=[REDACTED]&safe=visible`,
        },
      ]);
    });
  }
});

test('CLI adapter execution failures use the same observable failure flow', async () => {
  const { events, output } = outputEvents();
  let diagnoseCalls = 0;
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      throw new Error('adapter failed authorization: Basic cli-secret; safe=visible');
    },
    async diagnose() {
      diagnoseCalls += 1;
      return { state: 'error', message: 'unused' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const status = await runCliProcess(['chat', '--provider', 'gemini', 'hello'], output, {
    adapterFor: () => adapter,
    contextFor: () => context,
    timeout: { timeoutMs: 10, schedule: () => () => {} },
  });

  assert.equal(status, 1);
  assert.equal(diagnoseCalls, 0);
  assert.deepEqual(events, [
    {
      speaker: 'llmchat',
      tone: 'error',
      message: '[error] adapter failed authorization: Basic [REDACTED]; safe=visible',
    },
  ]);
});

test('CLI output redacts credential, session, secret, and id token assignments', async () => {
  const { events, output } = outputEvents();
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      throw new Error(
        'credential=one&credentials=two&session=three&secret=four&id_token=five&safe=visible',
      );
    },
    async diagnose() {
      return { state: 'error', message: 'unused' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  assert.equal(
    await runCliProcess(['chat', '--provider', 'gemini', 'hello'], output, {
      adapterFor: () => adapter,
      contextFor: () => context,
      timeout: { timeoutMs: 10, schedule: () => () => {} },
    }),
    1,
  );
  assert.equal(
    events[0].message,
    '[error] credential=[REDACTED]&credentials=[REDACTED]&session=[REDACTED]&secret=[REDACTED]&id_token=[REDACTED]&safe=visible',
  );
});

test('the default offline adapter exposes normalized health, diagnosis, and neutral context', async () => {
  const runtime = createChatRuntime(() => ({
    profileDirectory: 'profiles/gemini',
    diagnosticsDirectory: 'diagnostics/gemini',
  }));
  const adapter = runtime.adapterFor('gemini');
  const adapterContext = runtime.contextFor('gemini');

  assert.deepEqual(await adapter.diagnose(adapterContext), {
    state: 'progress',
    message: 'simulation is ready',
  });
  assert.deepEqual(await adapter.checkHealth(adapterContext), {
    status: 'healthy',
    message: 'simulation is ready',
  });
  assert.doesNotThrow(() => adapterContext.notify({ kind: 'progress', message: 'ignored' }));
  assert.match(adapterContext.profileDirectory, /profiles.+gemini/);
  assert.deepEqual(adapterContext.configuration, {});
});
