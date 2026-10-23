import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestedReasoning, resolveGeminiReasoning } from '../dist/config/reasoning.js';

test('Gemini supports the three current thinking levels for every visible model', () => {
  for (const model of ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro', '4 Argon']) {
    const definition = resolveGeminiReasoning(model);
    assert.deepEqual(
      definition.modes.map(({ name }) => name),
      ['Low', 'Medium', 'High'],
    );
    assert.equal(requestedReasoning(definition, undefined).name, 'Low');
  }
});

test('legacy reasoning values map to the equivalent current level', () => {
  const definition = resolveGeminiReasoning('3.8 Flash');
  assert.equal(requestedReasoning(definition, 'Standard').name, 'Low');
  assert.equal(requestedReasoning(definition, 'Extended thinking').name, 'High');
});

test('unknown Gemini models use current provider fallback capabilities', () => {
  const definition = resolveGeminiReasoning('future-model');
  assert.deepEqual(
    definition.modes.map(({ name }) => name),
    ['Low', 'Medium', 'High'],
  );
});

test('unsupported reasoning values do not resolve for a model', () => {
  assert.equal(requestedReasoning(resolveGeminiReasoning('3.1 Pro'), 'Deep mode'), undefined);
});
