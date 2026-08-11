import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AdapterTimeoutError,
  executeWithTimeout,
  runHealthCheck,
} from '../dist/adapter-contract.js';

const context = {
  profileDirectory: 'profiles/gemini',
  diagnosticsDirectory: 'diagnostics',
  configuration: { locale: 'en' },
  notify() {},
};

test('an adapter owns its chat workflow behind a provider-neutral request', async () => {
  const calls = [];
  const adapter = {
    provider: 'gemini',
    async executeChat(request, receivedContext) {
      calls.push({ request, context: receivedContext });
      return { text: `answer from ${request.model}` };
    },
    async diagnose() {
      return { state: 'progress', message: 'working' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };

  const response = await executeWithTimeout(adapter, { model: 'pro', prompt: 'hello' }, context, {
    timeoutMs: 100,
  });

  assert.deepEqual(response, { text: 'answer from pro' });
  assert.deepEqual(calls, [{ request: { model: 'pro', prompt: 'hello' }, context }]);
});

test('a CLI-owned timeout reports the adapter normalized diagnostic', async () => {
  let expire = () => {};
  let cancellations = 0;
  const adapter = {
    provider: 'chatgpt',
    async executeChat() {
      return new Promise(() => {});
    },
    async diagnose() {
      return { state: 'session-required', message: 'sign in' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const execution = executeWithTimeout(adapter, { prompt: 'hello' }, context, {
    timeoutMs: 10,
    schedule(callback) {
      expire = callback;
      return () => {
        cancellations += 1;
      };
    },
  });

  expire();

  await assert.rejects(execution, (error) => {
    assert.ok(error instanceof AdapterTimeoutError);
    assert.deepEqual(error.diagnostic, {
      state: 'session-required',
      message: 'sign in',
    });
    return true;
  });
  assert.equal(cancellations, 1);
});

test('the timeout is cancelled after success and synchronous or asynchronous failure', async (t) => {
  const cases = [
    { name: 'success', executeChat: () => Promise.resolve({ text: 'done' }) },
    {
      name: 'synchronous failure',
      executeChat() {
        throw new Error('sync failure');
      },
    },
    { name: 'asynchronous failure', executeChat: () => Promise.reject(new Error('async failure')) },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let cancellations = 0;
      const adapter = {
        provider: 'gemini',
        executeChat: scenario.executeChat,
        async diagnose() {
          return { state: 'error', message: 'unused' };
        },
        async checkHealth() {
          return { status: 'healthy', message: 'ready' };
        },
      };
      const execution = executeWithTimeout(adapter, { prompt: 'hello' }, context, {
        timeoutMs: 10,
        schedule: () => () => {
          cancellations += 1;
        },
      });

      if (scenario.name === 'success') await execution;
      else await assert.rejects(execution, /failure/);
      assert.equal(cancellations, 1);
    });
  }
});

test('manual health checks delegate UI interpretation to every adapter', async () => {
  const adapter = {
    provider: 'gemini',
    async executeChat() {
      return { text: '' };
    },
    async diagnose() {
      return { state: 'progress', message: 'idle' };
    },
    async checkHealth(receivedContext) {
      assert.equal(receivedContext, context);
      return { status: 'degraded', message: 'composer changed' };
    },
  };

  assert.deepEqual(await runHealthCheck(adapter, context), {
    status: 'degraded',
    message: 'composer changed',
  });
});
