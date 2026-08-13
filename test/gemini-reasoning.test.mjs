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

test('extended reasoning toggles after model selection and verifies the active button', async () => {
  const session = fixture({ reasoning: 'Standard' });
  await session.conversation.submit(
    { prompt: 'hello', model: 'Flash', reasoning: 'Extended thinking' },
    () => {},
  );
  const actions = session.calls.map((call) => (call[0] === 'click' ? call[1] : call[0]));
  assert.ok(actions.indexOf('choice:Flash') < actions.indexOf('choice:Extended thinking'));
  assert.ok(
    session.calls.filter((call) => call[0] === 'innerText' && call[1] === 'model').length >= 2,
  );
});

test('waits for the reasoning option after opening the model menu', async () => {
  const session = fixture({ reasoningVisibleAfter: 2 });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Extended thinking' }, (signal) =>
    signals.push(signal),
  );
  assert.equal(
    signals.some((signal) => signal.message?.includes('unavailable')),
    false,
  );
  assert.ok(session.calls.filter((call) => call[0] === 'exact-model').length >= 3);
});

test('standard reasoning opens the model menu and disables active extended mode', async () => {
  const session = fixture({ reasoning: 'Extended thinking' });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Standard' }, (signal) =>
    signals.push(signal),
  );
  assert.ok(
    session.calls.some((call) => call[0] === 'click' && call[1] === 'choice:Extended thinking'),
  );
  assert.ok(session.calls.some((call) => call[0] === 'click' && call[1] === 'model'));
  assert.equal(
    signals.some((signal) => signal.message?.includes('Warning')),
    false,
  );
});

test('unknown reasoning warns and leaves the chat usable', async () => {
  const session = fixture();
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Experimental' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /Warning: Gemini does not support reasoning/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('missing reasoning option warns and continues to send', async () => {
  const session = fixture({ reasoningVisible: false });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Extended thinking' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /reasoning option is unavailable/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('toggle click failure warns and continues to send', async () => {
  const session = fixture({ choiceThrows: true });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Extended thinking' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /toggle could not be changed/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('final verification failure warns and continues to send', async () => {
  const session = fixture({ reasoningStuck: true });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Extended thinking' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /could not be verified/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('matching selected menu state avoids a toggle click', async () => {
  const session = fixture({ reasoning: 'Extended thinking', buttonExtended: false });
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Extended thinking' }, () => {});
  assert.equal(
    session.calls.some((call) => call[0] === 'click' && call[1].startsWith('choice:')),
    false,
  );
});

test('explicit reasoning reports a missing model selector and continues', async () => {
  const session = fixture({ modelOpenerVisible: false });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Standard' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /model selector is unavailable/);
  assert.equal(signals.at(-1).kind, 'response');
});
