import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectModel } from '../dist/gemini-model-selection.js';
import { createGeminiPlaywrightPage } from '../dist/gemini-playwright-page.js';
import { geminiMenuFixture } from '../test-support/gemini-menu-fixture.mjs';
import { geminiUiFixture } from '../test-support/gemini-ui-fixture.mjs';
import { createGeminiUiConversation } from '../dist/gemini-ui-conversation.js';

async function choose(items, requested, selectedAfterClick) {
  const menu = geminiMenuFixture(items, selectedAfterClick);
  const page = createGeminiPlaywrightPage(menu.page, {});
  await selectModel(page, requested, () => {});
  return menu;
}

test('Flash selects the unique Flash model even when Flash-Lite comes first', async () => {
  const menu = await choose(
    [
      { label: '3.5 Flash-Lite' },
      { label: '3.6 Flash', description: 'More capable than Flash-Lite' },
    ],
    'Flash',
  );
  assert.deepEqual(menu.clicked, ['3.6 Flash']);
  assert.equal(menu.selected(), '3.6 Flash');
});

test('a full model name never matches a longer Lite name', async () => {
  const menu = await choose([{ label: '3.6 Flash-Lite' }, { label: '3.6 Flash' }], '3.6 Flash');
  assert.deepEqual(menu.clicked, ['3.6 Flash']);
});

test('explicit Flash Lite accepts its hyphenated label without choosing Flash', async () => {
  const menu = await choose([{ label: '3.6 Flash' }, { label: '3.5 Flash-Lite' }], 'Flash Lite');
  assert.deepEqual(menu.clicked, ['3.5 Flash-Lite']);
});

for (const items of [
  [{ label: '3.5 Flash-Lite' }],
  [{ label: '3.6 Flash', enabled: false }, { label: '3.5 Flash-Lite' }],
  [{ label: '2.5 Flash' }, { label: '3.6 Flash' }],
]) {
  test(`unavailable or ambiguous Flash is rejected: ${JSON.stringify(items)}`, async () => {
    await assert.rejects(choose(items, 'Flash'), /Flash.*unavailable|Flash.*ambiguous/);
  });
}

test('model switching must be confirmed before the requested model is accepted', async () => {
  await assert.rejects(
    choose([{ label: 'Flash' }], 'Flash', 'Flash-Lite'),
    /Flash.*selected|Flash.*confirm/,
  );
});

test('model names with regex punctuation are matched literally', async () => {
  const menu = await choose([{ label: 'Custom Pro' }, { label: 'Custom [Pro]+' }], 'Custom [Pro]+');
  assert.deepEqual(menu.clicked, ['Custom [Pro]+']);
});

test('padded Gemini menu labels keep Flash distinct from Flash Lite', async () => {
  const menu = await choose([{ label: ' 3.5 Flash-Lite ' }, { label: ' 3.8 Flash ' }], 'Flash');
  assert.deepEqual(menu.clicked, [' 3.8 Flash ']);
});

test('a full versioned model is confirmed from its selected menu option when the button abbreviates it', async () => {
  const menu = await choose([{ label: '3.8 Flash', buttonText: 'Flash' }], '3.8 Flash');
  assert.equal(menu.selected(), '3.8 Flash');
});

test('an abbreviated button cannot confirm the wrong version of Flash', async () => {
  await assert.rejects(
    choose(
      [
        { label: '2.5 Flash', buttonText: 'Flash' },
        { label: '3.8 Flash', buttonText: 'Flash' },
      ],
      '3.8 Flash',
      '2.5 Flash',
    ),
    /not confirmed/,
  );
});

test('model activity identifies the full option selected for a Flash alias', async () => {
  const menu = geminiMenuFixture([{ label: ' 3.8 Flash ', buttonText: 'Flash' }]);
  const page = createGeminiPlaywrightPage(menu.page, {});
  const events = [];
  await selectModel(page, 'Flash', (event) => events.push(event));
  assert.ok(
    events.some((event) => event.message === 'Gemini selected model menu option: 3.8 Flash'),
  );
});

for (const options of [
  { modelOpenerVisible: false },
  { choiceThrows: true },
  { modelVisible: false },
  { modelEnabled: false },
]) {
  test(`explicit Flash failures do not fill, send, or substitute Lite: ${JSON.stringify(options)}`, async () => {
    const session = geminiUiFixture(options);
    const conversation = createGeminiUiConversation(session.page, session.artifactPort, {
      send: async () => {},
    });
    await assert.rejects(conversation.submit({ prompt: 'hello', model: '3.6 Flash' }, () => {}));
    assert.equal(
      session.calls.some((call) => call[0] === 'fill' || call[1] === 'send'),
      false,
    );
    assert.equal(
      session.calls.some((call) => call[1] === 'choice:3.5 Flash-Lite'),
      false,
    );
  });
}

test('model selection waits for the requested option to appear before sending', async () => {
  const session = geminiUiFixture({ modelVisibleAfter: 2 });
  const conversation = createGeminiUiConversation(session.page, session.artifactPort, {
    send: async () => {},
  });
  await conversation.submit({ prompt: 'hello', model: 'Flash' }, () => {});
  assert.equal(
    session.calls.filter((call) => call[0] === 'click' && call[1] === 'choice:Flash').length,
    1,
  );
  assert.equal(session.calls.filter((call) => call[0] === 'fill').length, 1);
});
