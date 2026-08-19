import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyDefaults, readConfig } from '../dist/config.js';

function tempFile(content) {
  const directory = mkdtempSync(join(tmpdir(), 'llmchat-config-'));
  const path = join(directory, 'config.json');
  writeFileSync(path, content);
  return path;
}

function missingFile() {
  return join(mkdtempSync(join(tmpdir(), 'llmchat-config-')), 'missing.json');
}

test('readConfig accepts an object and treats a missing file as empty', () => {
  assert.deepEqual(readConfig(tempFile('{"defaultProvider":"gemini"}')), {
    defaultProvider: 'gemini',
  });
  assert.deepEqual(readConfig(missingFile()), {});
});

test('readConfig rejects every non-object configuration value', () => {
  for (const content of ['null', '[]', '"text"']) {
    assert.throws(() => readConfig(tempFile(content)), /Unable to read llmchat configuration/);
  }
});

test('readConfig preserves the parsing failure as an error cause', () => {
  assert.throws(
    () => readConfig(tempFile('not json')),
    (error) => error.cause instanceof Error && /Unable to read/.test(error.message),
  );
});

test('applyDefaults fills missing configuration values without changing the input', () => {
  const config = {};

  assert.deepEqual(applyDefaults(config), {
    schemaVersion: 1,
    defaultProvider: 'gemini',
  });
  assert.deepEqual(config, {});
});
