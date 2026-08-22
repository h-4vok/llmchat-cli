import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiResponseError, executeGeminiPrompt } from '../dist/gemini-flow.js';

const dormantTimeout = {
  inactivityMs: 100,
  schedule: () => () => {},
};

function controlledPort() {
  let signal = () => {};
  const submissions = [];
  let diagnoses = 0;
  return {
    port: {
      submit(request, emit) {
        submissions.push(request);
        signal = emit;
      },
      async diagnoseLocally() {
        diagnoses += 1;
        return { state: 'unknown', message: 'unused' };
      },
    },
    emit: (event) => signal(event),
    submissions,
    diagnosisCount: () => diagnoses,
  };
}

test('an explicit Gemini response completes one prompt', async () => {
  const session = controlledPort();
  const execution = executeGeminiPrompt(session.port, { prompt: 'Explain TDD' }, dormantTimeout);

  session.emit({ kind: 'response', text: 'Red, green, refactor', model: 'gemini-pro' });

  assert.deepEqual(await execution, {
    text: 'Red, green, refactor',
    model: 'gemini-pro',
  });
  assert.deepEqual(session.submissions, [{ prompt: 'Explain TDD' }]);
});

test('an explicit error signal fails without requesting a timeout diagnosis', async () => {
  const session = controlledPort();
  const execution = executeGeminiPrompt(session.port, { prompt: 'hello' }, dormantTimeout);

  session.emit({ kind: 'error', message: 'Gemini refused the request' });

  await assert.rejects(execution, (error) => {
    assert.ok(error instanceof GeminiResponseError);
    assert.equal(error.message, 'Gemini refused the request');
    return true;
  });
  assert.equal(session.diagnosisCount(), 0);
});

test('a valid response is accepted when Gemini changes the selected model', async () => {
  const session = controlledPort();
  const execution = executeGeminiPrompt(
    session.port,
    { prompt: 'hello', model: 'gemini-pro' },
    dormantTimeout,
  );

  session.emit({ kind: 'response', text: 'hello back', model: 'gemini-flash' });

  assert.deepEqual(await execution, { text: 'hello back', model: 'gemini-flash' });
  assert.equal(session.submissions.length, 1);
});

for (const outcome of ['resolve', 'reject']) {
  test(`external cancellation waits for submission to ${outcome}`, async () => {
    let settle;
    const cancellation = new AbortController();
    const port = {
      submit() {
        return new Promise((resolve, reject) => {
          settle = outcome === 'resolve' ? resolve : reject;
        });
      },
      async diagnoseLocally() {
        return { state: 'unknown', message: 'unused' };
      },
    };
    const execution = executeGeminiPrompt(
      port,
      { prompt: 'hello' },
      {
        ...dormantTimeout,
        signal: cancellation.signal,
      },
    );
    const reason = new Error('cancelled externally');

    cancellation.abort(reason);
    settle(new Error('submission settled'));

    await assert.rejects(execution, reason);
  });
}
