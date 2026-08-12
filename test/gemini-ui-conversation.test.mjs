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

test('new chat selects exact visible model, sends text once, and returns innerText', async () => {
  const session = fixture();
  const signals = [];

  await session.conversation.submit({ prompt: 'hello', model: 'Gemini 2.5 Pro' }, (signal) =>
    signals.push(signal),
  );

  assert.deepEqual(signals, [{ kind: 'response', text: 'plain **markdown**' }]);
  assert.ok(
    session.calls.some((call) => call[0] === 'exact-model' && call[1] === 'Gemini 2.5 Pro'),
  );
  assert.deepEqual(
    session.calls.filter((call) => call[0] === 'fill'),
    [['fill', 'composer', 'hello']],
  );
  assert.ok(session.calls.some((call) => call[0] === 'innerText' && call[1] === 'response'));
});

test('model fallback covers omitted, hidden, and changed model controls', async () => {
  for (const options of [
    { request: { prompt: 'hello' } },
    { modelOpenerVisible: false, request: { prompt: 'hello', model: 'Pro' } },
    { choiceThrows: true, request: { prompt: 'hello', model: 'Pro' } },
  ]) {
    const session = fixture(options);
    const signals = [];
    await session.conversation.submit(options.request, (signal) => signals.push(signal));
    assert.equal(signals.at(-1).kind, 'response');
  }
});

test('observable composition emits activity before the final response', async () => {
  const session = fixture({ composeFirst: true });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello' }, (signal) => signals.push(signal));
  assert.deepEqual(
    signals.map(({ kind }) => kind),
    ['activity', 'response'],
  );
});

test('waiting without a visible stop control does not invent activity', async () => {
  const session = fixture({ silentFirst: true });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello' }, (signal) => signals.push(signal));
  assert.deepEqual(signals, [{ kind: 'response', text: 'plain **markdown**' }]);
});

test('missing required controls fail descriptively', async () => {
  for (const missing of ['composer', 'send']) {
    const session = fixture({ missing });
    await assert.rejects(
      session.conversation.submit({ prompt: 'hello' }, () => {}),
      new RegExp(`required ${missing} selector`),
    );
  }
});

test('local diagnosis reports visible errors or stalled UI and closes explicitly', async () => {
  const errored = fixture({ errorText: 'token=private' });
  await errored.conversation.submit({ prompt: 'hello' }, () => {});
  assert.deepEqual(await errored.conversation.diagnoseLocally(), {
    state: 'error',
    message: 'token=[REDACTED]',
  });
  const stalled = fixture();
  assert.deepEqual(await stalled.conversation.diagnoseLocally(), {
    state: 'stalled',
    message: 'Gemini stopped producing observable UI activity.',
  });
  await stalled.conversation.close();
  assert.ok(stalled.calls.some((call) => call[0] === 'close-page'));
});

test('missing requested model falls back to the active model without error', async () => {
  const session = fixture({ modelVisible: false });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello', model: 'Unavailable' }, (signal) =>
    signals.push(signal),
  );
  assert.equal(signals[0].kind, 'response');
  assert.ok(session.calls.some((call) => call[0] === 'click' && call[1] === 'send'));
});

test('visible Gemini errors propagate their innerText', async () => {
  const session = fixture({ errorText: 'Daily quota exceeded' });
  const signals = [];
  await session.conversation.submit({ prompt: 'hello' }, (signal) => signals.push(signal));
  assert.deepEqual(signals, [{ kind: 'error', message: 'Daily quota exceeded' }]);
});

test('failure artifacts are redacted and capture only the provider viewport', async () => {
  const provider = fixture();
  await provider.conversation.persistFailure(new Error('token=secret&safe=visible'));
  assert.match(provider.artifacts[0][1], /token=\[REDACTED\]&safe=visible/);
  assert.equal(provider.artifacts[1][0], 'screenshot');

  const auth = fixture({ url: 'https://accounts.google.com/signin' });
  await auth.conversation.persistFailure(new Error('selector changed'));
  assert.deepEqual(
    auth.artifacts.map(([kind]) => kind),
    ['diagnostic'],
  );
});
