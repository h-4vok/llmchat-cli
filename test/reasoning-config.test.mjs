import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestedReasoning, resolveGeminiReasoning } from '../dist/config/reasoning.js';

test('Gemini resolves reasoning defaults per model', () => {
  const definition = resolveGeminiReasoning('3.6 Flash');
  assert.equal(requestedReasoning(definition, undefined).name, 'Standard');
  assert.equal(requestedReasoning(definition, 'Extended thinking').extended, true);
});

test('unknown Gemini models use provider fallback capabilities', () => {
  const definition = resolveGeminiReasoning('future-model');
  assert.deepEqual(
    definition.modes.map(({ name }) => name),
    ['Standard', 'Extended thinking'],
  );
});

test('unsupported reasoning values do not resolve for a model', () => {
  assert.equal(requestedReasoning(resolveGeminiReasoning('3.1 Pro'), 'Deep mode'), undefined);
});
