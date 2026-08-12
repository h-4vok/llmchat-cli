import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiInactivityError, executeGeminiPrompt } from '../dist/gemini-flow.js';

function manualTimeout(inactivityMs = 25) {
  const timers = [];
  return {
    options: {
      inactivityMs,
      schedule(expire, receivedMs) {
        const timer = { cancelled: false, expire, receivedMs };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    timers,
  };
}

function pendingSession(diagnostic = { state: 'stalled', message: 'composer stopped' }) {
  let emit = () => {};
  let submitCalls = 0;
  let diagnoseCalls = 0;
  return {
    port: {
      submit(_request, observer) {
        submitCalls += 1;
        emit = observer;
      },
      async diagnoseLocally() {
        diagnoseCalls += 1;
        return diagnostic;
      },
    },
    emit: (signal) => emit(signal),
    submitCount: () => submitCalls,
    diagnosisCount: () => diagnoseCalls,
  };
}

test('observable activity reports progress and extends the inactivity wait', async () => {
  const timeout = manualTimeout(40);
  const session = pendingSession();
  const activity = [];
  const execution = executeGeminiPrompt(
    session.port,
    { prompt: 'hello' },
    { ...timeout.options, onActivity: (event) => activity.push(event) },
  );

  session.emit({ kind: 'activity', message: 'Gemini is composing' });

  assert.deepEqual(activity, [{ kind: 'activity', message: 'Gemini is composing' }]);
  assert.equal(timeout.timers.length, 2);
  assert.equal(timeout.timers[0].cancelled, true);
  assert.equal(timeout.timers[1].receivedMs, 40);
  timeout.timers[0].expire();
  session.emit({ kind: 'response', text: 'done' });
  assert.deepEqual(await execution, { text: 'done' });
  assert.equal(session.diagnosisCount(), 0);
});

test('inactivity fails after requesting one local diagnostic', async () => {
  const timeout = manualTimeout();
  const session = pendingSession();
  const execution = executeGeminiPrompt(session.port, { prompt: 'hello' }, timeout.options);

  timeout.timers[0].expire();

  await assert.rejects(execution, (error) => {
    assert.ok(error instanceof GeminiInactivityError);
    assert.deepEqual(error.diagnostic, {
      state: 'stalled',
      message: 'composer stopped',
    });
    return true;
  });
  assert.equal(session.diagnosisCount(), 1);
});

test('activity and timeout never resend the prompt', async () => {
  const timeout = manualTimeout();
  const session = pendingSession();
  const execution = executeGeminiPrompt(session.port, { prompt: 'only once' }, timeout.options);

  session.emit({ kind: 'activity', message: 'started' });
  session.emit({ kind: 'activity', message: 'still working' });
  timeout.timers.at(-1).expire();

  await assert.rejects(execution, GeminiInactivityError);
  assert.equal(session.submitCount(), 1);
});
