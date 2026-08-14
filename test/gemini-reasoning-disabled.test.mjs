import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectReasoningMode } from '../dist/gemini-model-selection.js';

test('reasoning disabled after menu load is rejected before its active state is queried', async () => {
  let available = true;
  const opener = {
    visible: async () => true,
    enabled: async () => true,
    click: async () => {},
  };
  const choice = {
    visible: async () => true,
    enabled: async () => {
      const result = available;
      available = false;
      return result;
    },
    active: async () => assert.fail('disabled option must not be queried as active'),
  };
  const page = {
    element: () => opener,
    exactText: () => choice,
    wait: async () => {},
  };
  const signals = [];
  await selectReasoningMode(page, 'Extended thinking', '3.6 Flash', (signal) =>
    signals.push(signal),
  );
  assert.match(signals[0].message, /reasoning option is unavailable/);
});
