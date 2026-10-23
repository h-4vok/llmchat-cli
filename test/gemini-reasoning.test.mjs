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

test('medium reasoning opens its submenu and verifies the selected level', async () => {
  const session = fixture();
  await session.conversation.submit(
    { prompt: 'hello', model: '3.8 Flash', reasoning: 'Medium' },
    () => {},
  );
  const actions = session.calls.map((call) => (call[0] === 'click' ? call[1] : call[0]));
  assert.ok(actions.indexOf('choice:3.8 Flash') < actions.indexOf('choice:Thinking level'));
  assert.ok(actions.indexOf('choice:Thinking level') < actions.indexOf('choice:Medium'));
  assert.ok(
    session.calls.filter((call) => call[0] === 'exact-model' && call[1] === 'Medium').length >= 2,
  );
});

test('waits for the requested reasoning level after opening both menus', async () => {
  const session = fixture({ reasoningVisibleAfter: 2 });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.equal(
    signals.some((signal) => signal.message?.includes('unavailable')),
    false,
  );
  assert.ok(
    session.calls.filter((call) => call[0] === 'exact-model' && call[1] === 'High').length >= 2,
  );
});

test('standard reasoning selects Low from an active High level', async () => {
  const session = fixture({ reasoning: 'High' });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Standard' }, (signal) =>
    signals.push(signal),
  );
  assert.ok(session.calls.some((call) => call[0] === 'click' && call[1] === 'choice:Low'));
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
  await session.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /reasoning option is unavailable/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('disabled reasoning option warns and continues to send', async () => {
  const session = fixture({ reasoningEnabled: false });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /reasoning option is unavailable/);
});

test('reasoning option disappearing before selection warns and continues to send', async () => {
  const session = fixture();
  const exactText = session.page.exactText;
  let visibilityChecks = 0;
  session.page.exactText = (text) => {
    const choice = exactText(text);
    if (text === 'High') {
      const visible = choice.visible;
      choice.visible = async () => ++visibilityChecks === 1 && visible();
    }
    return choice;
  };
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /reasoning option is unavailable/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('reasoning level click failure warns and continues to send', async () => {
  const session = fixture({ choiceThrows: true });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /level could not be selected/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('final verification failure warns and continues to send', async () => {
  const session = fixture({ reasoning: 'Medium', reasoningStuck: true });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /verification found reasoning level "High" was not selected/);
  assert.equal(signals.at(-1).kind, 'response');
});

test('matching selected level avoids a second selection click', async () => {
  const session = fixture({ reasoning: 'High' });
  await session.conversation.submit({ prompt: 'hello', reasoning: 'Extended thinking' }, () => {});
  assert.equal(
    session.calls.filter((call) => call[0] === 'click' && call[1] === 'choice:High').length,
    0,
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
