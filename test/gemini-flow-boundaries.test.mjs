import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiInactivityError, executeGeminiPrompt } from '../dist/gemini-flow.js';

const diagnostic = { state: 'stalled', message: 'locally inspected' };

function options(schedule = () => () => {}) {
  return { inactivityMs: 5, schedule };
}

test('synchronous and asynchronous submission failures remain terminal', async (t) => {
  for (const scenario of [
    {
      name: 'synchronous',
      submit() {
        throw new Error('synchronous submit failure');
      },
    },
    {
      name: 'asynchronous',
      submit: () => Promise.reject(new Error('asynchronous submit failure')),
    },
  ]) {
    await t.test(scenario.name, async () => {
      const port = {
        submit: scenario.submit,
        async diagnoseLocally() {
          return diagnostic;
        },
      };

      await assert.rejects(
        executeGeminiPrompt(port, { prompt: 'hello' }, options()),
        /submit failure/,
      );
    });
  }
});

test('the default local timer enforces configurable inactivity', async () => {
  const port = {
    submit() {},
    async diagnoseLocally() {
      return diagnostic;
    },
  };

  await assert.rejects(
    executeGeminiPrompt(port, { prompt: 'hello' }, { inactivityMs: 0 }),
    (error) => {
      assert.ok(error instanceof GeminiInactivityError);
      assert.deepEqual(error.diagnostic, diagnostic);
      return true;
    },
  );
});

test('a failed local diagnosis still leaves the timed-out execution failed', async () => {
  let expire = () => {};
  const diagnosticFailure = new Error('local diagnosis unavailable');
  const port = {
    submit() {},
    async diagnoseLocally() {
      throw diagnosticFailure;
    },
  };
  const execution = executeGeminiPrompt(
    port,
    { prompt: 'hello' },
    options((callback) => {
      expire = callback;
      return () => {};
    }),
  );

  expire();

  await assert.rejects(execution, diagnosticFailure);
});

test('late adapter outcomes cannot replace a completed response', async () => {
  let emit = () => {};
  let expire = () => {};
  let rejectSubmission = () => {};
  const submission = new Promise((_resolve, reject) => {
    rejectSubmission = reject;
  });
  const port = {
    submit(_request, observer) {
      emit = observer;
      return submission;
    },
    async diagnoseLocally() {
      return diagnostic;
    },
  };
  const execution = executeGeminiPrompt(
    port,
    { prompt: 'hello' },
    options((callback) => {
      expire = callback;
      return () => {};
    }),
  );

  emit({ kind: 'response', text: 'first terminal result' });
  emit({ kind: 'error', message: 'too late' });
  expire();
  rejectSubmission(new Error('also too late'));

  assert.deepEqual(await execution, { text: 'first terminal result' });
});
