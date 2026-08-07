import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const cli = join(process.cwd(), 'dist', 'cli.js');
function run(configHome, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: configHome, USERPROFILE: configHome, LOCALAPPDATA: configHome },
  });
}

function configFile(configHome) {
  const relative =
    process.platform === 'win32'
      ? ['llmchat', 'config.json']
      : process.platform === 'darwin'
        ? ['Library', 'Application Support', 'llmchat', 'config.json']
        : ['.config', 'llmchat', 'config.json'];
  return join(configHome, ...relative);
}

test('chat supports provider precedence and deterministic output', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  const missing = run(configHome, 'chat', 'hello');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /No provider selected/);
  assert.equal(missing.stdout, '');
  const beforePrompt = run(configHome, 'chat', '--provider', 'gemini', 'hello');
  assert.equal(beforePrompt.status, 0);
  assert.match(beforePrompt.stdout, /gemini.*hello/i);
  const afterPrompt = run(configHome, 'chat', 'hello', '--provider', 'gemini');
  assert.equal(afterPrompt.status, 0);
  assert.match(afterPrompt.stdout, /gemini.*hello/i);
  assert.equal(run(configHome, 'config', 'set-default-provider', 'gemini').status, 0);
  const file = configFile(configHome);
  const config = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(config.schemaVersion, 1);
  config.futureSetting = { enabled: true };
  writeFileSync(file, `${JSON.stringify(config)}\n`);
  assert.equal(run(configHome, 'config', 'set-default-provider', 'gemini').status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).futureSetting, { enabled: true });
  const saved = run(configHome, 'chat', 'hello');
  assert.match(saved.stdout, /gemini.*hello/i);
  assert.equal(run(configHome, 'chat', 'hello', '--provider', 'openai').status !== 0, true);
  assert.match(readFileSync(file, 'utf8'), /gemini/);
});

test('configuration validation, clearing, and help are predictable', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  const invalid = run(configHome, 'config', 'set-default-provider', 'openai');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unsupported provider/);
  assert.equal(run(configHome, 'config', 'clear-default-provider').status, 0);
  assert.match(run(configHome, '--help').stdout, /Usage:.*chat/s);
  const configHelp = run(configHome, 'config', '--help');
  assert.equal(configHelp.status, 0);
  assert.match(configHelp.stdout, /set-default-provider/);
  assert.match(configHelp.stdout, /gemini/);
  assert.equal(run(configHome, 'chat', '--help').status, 0);
  assert.equal(run(configHome, 'config', 'set-default-provider', 'gemini').status, 0);
  assert.equal(run(configHome, 'config', 'clear-default-provider').status, 0);
  const cleared = JSON.parse(readFileSync(configFile(configHome), 'utf8'));
  assert.equal(cleared.schemaVersion, 1);
  assert.equal(cleared.defaultProvider, undefined);
  assert.equal(run(configHome, 'config', 'clear-default-provider').status, 0);
  assert.notEqual(run(configHome, 'chat', 'hello', '--provider', 'openai').status, 0);
});

test('malformed configuration fails without replacing the file', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  const file = configFile(configHome);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '{not-json');
  const result = run(configHome, 'chat', 'hello');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to read llmchat configuration/);
  assert.equal(readFileSync(file, 'utf8'), '{not-json');
});
