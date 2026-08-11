import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../test-support/cli-helper.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
}

test('root help accepts omitted and short commands', () => {
  for (const args of [[], ['-h']]) {
    const result = run(tempHome(), ...args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  }
});

test('config help accepts omitted and short actions', () => {
  for (const args of [['config'], ['config', '-h']]) {
    const result = run(tempHome(), ...args);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /set-default-provider/);
  }
});

test('the cli rejects invalid command shapes', () => {
  const cases = [
    [['unknown'], /Unknown command/],
    [['config', 'unknown'], /Invalid config command/],
    [['config', 'set-default-provider'], /Invalid config command/],
    [['config', 'clear-default-provider', 'extra'], /Invalid config command/],
    [['chat', '--provider', 'gemini'], /A prompt is required/],
  ];
  for (const [args, message] of cases) {
    const result = run(tempHome(), ...args);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, message);
  }
});
