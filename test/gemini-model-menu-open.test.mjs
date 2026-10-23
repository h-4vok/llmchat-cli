import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openModelSelection } from '../dist/gemini-model-selection.js';

function pageWithModelMenu(expanded) {
  const calls = [];
  const opener = {
    visible: async () => true,
    enabled: async () => true,
    expanded: async () => expanded,
    click: async () => calls.push('click'),
  };
  return { calls, page: { element: () => opener } };
}

test('reuses the model menu when its opener reports expanded', async () => {
  const fixture = pageWithModelMenu(true);
  await openModelSelection(fixture.page);
  assert.deepEqual(fixture.calls, []);
});

test('clicks the model opener when the menu is collapsed', async () => {
  const fixture = pageWithModelMenu(false);
  await openModelSelection(fixture.page);
  assert.deepEqual(fixture.calls, ['click']);
});
