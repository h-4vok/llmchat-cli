import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiAdapter } from '../dist/gemini-adapter.js';

const context = {
  profileDirectory: '/profiles/gemini',
  diagnosticsDirectory: '/diagnostics/gemini',
  screenshotsDirectory: '/screenshots/gemini',
  configuration: {},
  notify() {},
};

function fixture(signal) {
  const calls = [];
  const conversation = {
    submit(request, emit) {
      calls.push(['submit', request]);
      for (const event of Array.isArray(signal) ? signal : [signal]) emit(event);
    },
    async diagnoseLocally() {
      calls.push(['diagnose']);
      return { state: 'stalled', message: 'local detail' };
    },
    async persistFailure(error) {
      calls.push(['persist', error.message]);
    },
    async close() {
      calls.push(['close']);
    },
  };
  const browser = {
    async open(received) {
      calls.push(['open', received]);
      return conversation;
    },
    async health(received) {
      calls.push(['health', received]);
      return { status: 'healthy', message: 'Gemini composer is available.' };
    },
  };
  return { adapter: createGeminiAdapter({ browser, inactivityMs: 10 }), calls };
}

test('Gemini adapter opens one conversation, submits once, and closes after success', async () => {
  const { adapter, calls } = fixture({ kind: 'response', text: 'plain text', model: 'Flash' });

  assert.deepEqual(await adapter.executeChat({ prompt: 'hello', model: 'Pro' }, context), {
    text: 'plain text',
  });
  assert.deepEqual(calls, [
    ['open', context],
    ['submit', { prompt: 'hello', model: 'Pro' }],
    ['close'],
  ]);
});

test('Gemini adapter forwards reasoning to the conversation', async () => {
  const { adapter, calls } = fixture({ kind: 'response', text: 'plain text' });
  await adapter.executeChat({ prompt: 'hello', reasoning: 'Extended thinking' }, context);
  assert.deepEqual(calls[1], [
    'submit',
    { prompt: 'hello', model: undefined, reasoning: 'Extended thinking' },
  ]);
});

test('diagnosis tracks activity, completion, and non-Error failures safely', async () => {
  const active = fixture([
    { kind: 'activity', message: 'token=secret' },
    { kind: 'response', text: 'done' },
  ]);
  const notifications = [];
  await active.adapter.executeChat(
    { prompt: 'hello' },
    { ...context, notify: (event) => notifications.push(event) },
  );
  assert.deepEqual(notifications, [{ kind: 'progress', message: 'token=[REDACTED]' }]);
  assert.deepEqual(await active.adapter.diagnose(context), {
    state: 'progress',
    message: 'Gemini response completed.',
  });

  const broken = fixture({ kind: 'response', text: 'unused' });
  broken.adapter = createGeminiAdapter({
    inactivityMs: 10,
    browser: {
      async open() {
        return {
          submit() {
            throw 'plain failure';
          },
          async diagnoseLocally() {
            return { state: 'error', message: 'unused' };
          },
          async persistFailure() {},
          async close() {},
        };
      },
      async health() {
        return { status: 'healthy', message: 'unused' };
      },
    },
  });
  await assert.rejects(broken.adapter.executeChat({ prompt: 'hello' }, context), /plain failure/);
  assert.deepEqual(await broken.adapter.diagnose(context), {
    state: 'error',
    message: 'plain failure',
  });
});

test('visible provider errors persist diagnostics and preserve the browser', async () => {
  const { adapter, calls } = fixture({ kind: 'error', message: 'Quota exceeded' });

  await assert.rejects(adapter.executeChat({ prompt: 'hello' }, context), /Quota exceeded/);
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['open', 'submit', 'persist'],
  );
});

test('manual health check inspects UI without opening or submitting a conversation', async () => {
  const { adapter, calls } = fixture({ kind: 'response', text: 'unused' });

  assert.deepEqual(await adapter.checkHealth(context), {
    status: 'healthy',
    message: 'Gemini composer is available.',
  });
  assert.deepEqual(calls, [['health', context]]);
});
