import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiUiConversation } from '../dist/gemini-ui-conversation.js';
import { geminiUiFixture } from '../test-support/gemini-ui-fixture.mjs';

function session(options) {
  const fixture = geminiUiFixture(options);
  return {
    ...fixture,
    conversation: createGeminiUiConversation(fixture.page, fixture.artifactPort, {
      send: async () => {},
    }),
  };
}

async function verificationWarning(configure, expected) {
  const fixture = session();
  configure(fixture.page);
  const signals = [];
  await fixture.conversation.submit({ prompt: 'hello', reasoning: 'High' }, (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, expected);
  assert.equal(signals.at(-1).kind, 'response');
}

test('verification warning identifies when Thinking level never appears', async () => {
  await verificationWarning((page) => {
    const exactText = page.exactText;
    let lookups = 0;
    page.exactText = (text) => {
      const choice = exactText(text);
      if (text === 'Thinking level' && ++lookups > 1) choice.visible = async () => false;
      return choice;
    };
  }, /verification.*Thinking level/i);
});

test('verification warning identifies when requested level never appears', async () => {
  await verificationWarning((page) => {
    const exactText = page.exactText;
    let lookups = 0;
    page.exactText = (text) => {
      const choice = exactText(text);
      if (text === 'High' && ++lookups > 1) choice.visible = async () => false;
      return choice;
    };
  }, /verification.*High/i);
});

test('waits before model selection, reasoning selection, and reasoning verification', async () => {
  const fixture = session({ reasoning: 'High' });
  const wait = fixture.page.wait.bind(fixture.page);
  fixture.page.wait = async () => {
    fixture.calls.push(['wait']);
    await wait();
  };
  await fixture.conversation.submit({ prompt: 'hello', reasoning: 'Low' }, () => {});
  const selected = fixture.calls.findIndex(
    (call) => call[0] === 'click' && call[1] === 'choice:Low',
  );
  const modelClicks = fixture.calls
    .map((call, index) => (call[0] === 'click' && call[1] === 'model' ? index : -1))
    .filter((index) => index >= 0);
  const waits = fixture.calls
    .map((call, index) => (call[0] === 'wait' ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(waits.some((index) => index < modelClicks[0]));
  assert.ok(waits.some((index) => index > modelClicks[0] && index < modelClicks[1]));
  assert.ok(waits.some((index) => index > selected && index < modelClicks[2]));
});
