import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiUiConversation } from '../dist/gemini-ui-conversation.js';
import { geminiUiFixture } from '../test-support/gemini-ui-fixture.mjs';

function fixture(options) {
  const result = geminiUiFixture(options);
  return {
    ...result,
    conversation: createGeminiUiConversation(result.page, result.artifactPort, {
      send: async () => {},
    }),
  };
}

test('non-disposable chat does not activate Temporary chat', async () => {
  const session = fixture();
  await session.conversation.submit({ prompt: 'hello', disposableConversation: false }, () => {});
  assert.equal(
    session.calls.some((call) => call[0] === 'click' && call[1] === 'temporary-chat'),
    false,
  );
});

test('disposable chat fails clearly when Temporary chat control is unavailable', async () => {
  const session = fixture({ missing: 'temporaryChat' });
  await assert.rejects(
    session.conversation.submit({ prompt: 'hello', disposableConversation: true }, () => {}),
    /required temporaryChat selector/,
  );
});

test('Temporary chat activation failures propagate to the provider workflow', async () => {
  const session = fixture({ temporaryChatClickFails: true });
  await assert.rejects(
    session.conversation.submit({ prompt: 'hello', disposableConversation: true }, () => {}),
    /temporary chat click failed/,
  );
});
