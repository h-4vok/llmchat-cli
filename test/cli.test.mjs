import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const cli = join(process.cwd(), 'dist', 'cli.js');
function run(configHome, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: configHome },
  });
}

test('chat supports provider precedence and deterministic output', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  assert.match(run(configHome, 'chat', 'hello').stderr, /No provider selected/);
  assert.equal(run(configHome, 'chat', '--provider', 'gemini', 'hello').status, 0);
  assert.match(run(configHome, 'chat', 'hello', '--provider', 'gemini').stdout, /Gemini.*hello/i);
  assert.equal(run(configHome, 'config', 'set-default-provider', 'gemini').status, 0);
  assert.match(run(configHome, 'chat', 'hello').stdout, /gemini.*hello/i);
  assert.match(readFileSync(join(configHome, 'llmchat', 'config.json'), 'utf8'), /gemini/);
});

test('configuration validation, clearing, and help are predictable', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  const invalid = run(configHome, 'config', 'set-default-provider', 'openai');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unsupported provider/);
  assert.equal(run(configHome, 'config', 'clear-default-provider').status, 0);
  assert.match(run(configHome, '--help').stdout, /Usage:.*chat/s);
  assert.match(run(configHome, 'config', '--help').stdout, /set-default-provider/);
  assert.equal(run(configHome, 'config', 'set-default-provider', 'gemini').status, 0);
  assert.equal(run(configHome, 'config', 'clear-default-provider').status, 0);
  assert.equal(run(configHome, 'config', 'clear-default-provider').status, 0);
  assert.notEqual(run(configHome, 'chat', 'hello', '--provider', 'openai').status, 0);
});
