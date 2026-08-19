import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdapterTimeoutError, executeWithTimeout } from '../dist/adapter-contract.js';

test('a CLI timeout aborts adapter work and waits for cancellation to settle', async () => {
  let expire = () => {};
  let finishCancellation = () => {};
  const calls = [];
  const adapter = {
    provider: 'gemini',
    executeChat(_request, _context, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          calls.push('aborted');
          finishCancellation = () => {
            calls.push('settled');
            reject(signal.reason);
          };
        });
      });
    },
    async diagnose() {
      calls.push('diagnosed');
      return { state: 'error', message: 'stopped' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const context = { notify() {} };
  const execution = executeWithTimeout(adapter, { prompt: 'hello' }, context, {
    timeoutMs: 10,
    schedule(callback) {
      expire = callback;
      return () => {};
    },
  });

  expire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['aborted']);
  finishCancellation();

  await assert.rejects(execution, AdapterTimeoutError);
  assert.deepEqual(calls, ['aborted', 'settled', 'diagnosed']);
});
