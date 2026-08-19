import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeChat } from '../dist/chat-command.js';

test('executeChat accepts one cohesive chat command input', async () => {
  const events = [];
  const context = {
    profileDirectory: 'profiles/gemini',
    diagnosticsDirectory: 'diagnostics/gemini',
    screenshotsDirectory: 'screenshots/gemini',
    configuration: {},
    notify() {},
  };
  const runtime = {
    timeout: { timeoutMs: 1000, schedule: (expire) => () => expire() },
    adapterFor: () => ({ executeChat: async () => ({ text: 'answer' }) }),
  };

  await executeChat({
    runtime,
    provider: 'gemini',
    context,
    request: { prompt: 'hello' },
    keepBrowserOpen: false,
    output: { emit: (event) => events.push(event) },
  });

  assert.deepEqual(events, [{ speaker: 'gemini', message: 'answer' }]);
});
