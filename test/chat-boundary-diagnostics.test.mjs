import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeChatWithContext } from '../dist/chat-execution.js';

function fixture() {
  const records = [];
  const context = {
    profileDirectory: 'profile',
    diagnosticsDirectory: 'diagnostics',
    screenshotsDirectory: 'screenshots',
    configuration: {},
    notify() {},
  };
  return {
    records,
    runtime: {
      adapterFor: () => ({
        provider: 'gemini',
        async executeChat() {
          return { text: 'answer before boundary failure' };
        },
      }),
      contextFor: () => context,
      recordChat: (_provider, transcript) => records.push(transcript),
      timeout: { timeoutMs: 50 },
    },
  };
}

async function execute(runtime) {
  return executeChatWithContext({
    runtime,
    provider: 'gemini',
    request: { prompt: 'hello' },
    keepBrowserOpen: false,
  });
}

test('context creation failure records the returned terminal transcript once', async () => {
  const { runtime, records } = fixture();
  runtime.contextFor = () => {
    throw new Error('context failed');
  };

  const transcript = await execute(runtime);

  assert.equal(transcript.status, 'failure');
  assert.deepEqual(records, [transcript]);
});

test('activity subscription failure records the returned terminal transcript once', async () => {
  const { runtime, records } = fixture();
  const contextFor = runtime.contextFor;
  runtime.contextFor = () => ({
    ...contextFor(),
    onActivity() {
      throw new Error('subscription failed');
    },
  });

  const transcript = await execute(runtime);

  assert.equal(transcript.status, 'failure');
  assert.deepEqual(records, [transcript]);
});

test('context release failure records the returned terminal transcript once', async () => {
  const { runtime, records } = fixture();
  runtime.releaseContext = async () => {
    throw new Error('release failed');
  };

  const transcript = await execute(runtime);

  assert.equal(transcript.status, 'failure');
  assert.equal(transcript.response.text, 'answer before boundary failure');
  assert.deepEqual(records, [transcript]);
});
