import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isValidProvider, resolveProvider } from '../dist/provider-selection.js';

function withConfig(defaultProvider, callback) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-provider-'));
  const directory = join(root, 'llmchat');
  mkdirSync(directory);
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ defaultProvider }));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = root;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
  }
}

test('resolveProvider prefers explicit provider and validates once', () => {
  assert.equal(
    withConfig('unsupported', () => resolveProvider('gemini')),
    'gemini',
  );
});

test('resolveProvider uses configured provider and defaults when absent', () => {
  assert.equal(
    withConfig('gemini', () => resolveProvider(undefined)),
    'gemini',
  );
  assert.throws(
    () => withConfig('unsupported', () => resolveProvider(undefined)),
    /Unsupported provider/,
  );
  assert.equal(
    withConfig(undefined, () => resolveProvider(undefined)),
    'gemini',
  );
});

test('isValidProvider answers validity without throwing', () => {
  assert.equal(isValidProvider('gemini'), true);
  assert.equal(isValidProvider('unsupported'), false);
});
