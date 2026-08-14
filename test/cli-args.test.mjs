import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChat } from '../dist/cli-args.js';

test('parseChat collects prompt words and provider options', () => {
  assert.deepEqual(parseChat(['hello', 'world', '--provider', 'gemini']), {
    help: false,
    model: undefined,
    prompt: 'hello world',
    provider: 'gemini',
    systemInstructions: undefined,
    keepBrowserOpen: false,
  });
});

test('parseChat preserves the visible model text exactly', () => {
  assert.equal(parseChat(['hello', '--model', 'Gemini 2.5 Pro']).model, 'Gemini 2.5 Pro');
});

test('parseChat preserves reasoning text exactly, including spaces', () => {
  assert.equal(
    parseChat(['hello', '--reasoning', 'Extended thinking']).reasoning,
    'Extended thinking',
  );
});

test('parseChat leaves the prompt unset when no prompt words are provided', () => {
  assert.equal(parseChat([]).prompt, undefined);
});

test('parseChat trims surrounding prompt whitespace', () => {
  assert.equal(parseChat(['  hello  ']).prompt, 'hello');
});

test('parseChat accepts every system-instructions alias', () => {
  for (const flag of ['--gem', '--gpt', '--system-instructions']) {
    assert.equal(parseChat([flag, 'Helpful', 'hello']).systemInstructions, 'Helpful');
  }
});

test('parseChat recognizes help without parsing the remaining arguments', () => {
  assert.deepEqual(parseChat(['--help', '--unknown']), { help: true });
  assert.deepEqual(parseChat(['-h']), { help: true });
});

test('parseChat recognizes keep-browser-open without consuming a value', () => {
  assert.equal(parseChat(['--keep-browser-open', 'hello']).keepBrowserOpen, true);
});

test('parseChat rejects missing option values', () => {
  assert.throws(() => parseChat(['--provider']), /--provider requires a value/);
  assert.throws(() => parseChat(['--model']), /--model requires a value/);
  assert.throws(() => parseChat(['--gem', '--provider', 'gemini']), /--gem requires a value/);
});

test('parseChat rejects conflicting or unknown options', () => {
  assert.throws(() => parseChat(['--gem', 'one', '--gpt', 'two']), /Conflicting options/);
  assert.throws(() => parseChat(['--unknown']), /Unknown option/);
});
