import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiPlaywrightPage } from '../dist/gemini-playwright-page.js';

function locator(name) {
  return {
    filter() {
      return this;
    },
    async evaluate(callback) {
      if (name === 'detached') throw new Error('detached');
      const selected = name === 'selected';
      return callback({
        classList: { contains: () => selected },
        querySelector: () => (name === 'nested-selected' ? {} : null),
      });
    },
  };
}

function boundary(name) {
  const page = {
    locator: () => locator(name),
    getByText: () => ({}),
    getByRole: () => locator(name),
  };
  return createGeminiPlaywrightPage(page, {});
}

test('selected menu items expose their active state', async () => {
  assert.equal(await boundary('selected').exactText('High').active(), true);
});

test('nested selected menu icons expose their active state', async () => {
  assert.equal(await boundary('nested-selected').exactText('High').active(), true);
});

test('detached menu items are treated as inactive', async () => {
  assert.equal(await boundary('detached').exactText('High').active(), false);
});
