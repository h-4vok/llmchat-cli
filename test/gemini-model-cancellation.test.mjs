import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectModel } from '../dist/gemini-model-selection.js';
import { createGeminiPlaywrightPage } from '../dist/gemini-playwright-page.js';
import { geminiMenuFixture } from '../test-support/gemini-menu-fixture.mjs';

test('model selection preserves cancellation while waiting for its choice', async () => {
  const menu = geminiMenuFixture([{ label: '3.8 Flash' }]);
  const page = createGeminiPlaywrightPage(menu.page, {});
  const controller = new AbortController();
  const opener = page.element('model');
  const click = opener.click.bind(opener);
  opener.click = async () => {
    await click();
    controller.abort();
  };
  const originalElement = page.element.bind(page);
  page.element = (name) => (name === 'model' ? opener : originalElement(name));

  await assert.rejects(
    selectModel(page, '3.8 Flash', () => {}, controller.signal),
    {
      name: 'AbortError',
    },
  );
  assert.deepEqual(menu.clicked, []);
});
