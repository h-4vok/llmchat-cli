import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiUiConversation } from '../dist/gemini-ui-conversation.js';
import { geminiUiFixture } from '../test-support/gemini-ui-fixture.mjs';

test('the UI monitoring loop stops after cancellation', async () => {
  const fixture = geminiUiFixture({ silentFirst: true });
  let finishWait = () => {};
  fixture.page.wait = () =>
    new Promise((resolve) => {
      finishWait = resolve;
    });
  const conversation = createGeminiUiConversation(fixture.page, fixture.artifactPort, {
    send: async () => {},
  });
  const cancellation = new AbortController();
  const execution = conversation.submit({ prompt: 'hello' }, () => {}, cancellation.signal);
  await new Promise((resolve) => setImmediate(resolve));

  const reason = new Error('cancelled by caller');
  cancellation.abort(reason);
  finishWait();

  await assert.rejects(execution, reason);
});
