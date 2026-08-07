import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const cli = join(process.cwd(), 'dist', 'cli.js');
function run(configHome, ...args) {
  const options = typeof args[0] === 'object' ? args.shift() : {};
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: configHome,
      USERPROFILE: configHome,
      LOCALAPPDATA: configHome,
      ...options.env,
    },
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

test('Linux configuration honors XDG_CONFIG_HOME before HOME', () => {
  if (process.platform !== 'linux') return;
  const home = mkdtempSync(join(tmpdir(), 'llmchat-home-'));
  const xdgConfigHome = mkdtempSync(join(tmpdir(), 'llmchat-xdg-'));
  const xdgFile = join(xdgConfigHome, 'llmchat', 'config.json');
  const homeFile = join(home, '.config', 'llmchat', 'config.json');

  const saved = run(
    home,
    { env: { XDG_CONFIG_HOME: xdgConfigHome } },
    'config',
    'set-default-provider',
    'gemini',
  );
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(readFileSync(xdgFile, 'utf8')).defaultProvider, 'gemini');
  assert.throws(() => readFileSync(homeFile, 'utf8'), { code: 'ENOENT' });
});

test('system-instructions aliases are equivalent and provider-neutral', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  for (const flag of ['--gem', '--gpt', '--system-instructions']) {
    const result = run(configHome, 'chat', '--provider', 'gemini', flag, 'My Assistant', 'hello');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /using system instructions "My Assistant"/);
  }
  const mismatch = run(
    configHome,
    'chat',
    '--provider',
    'gemini',
    '--gpt',
    'My Assistant',
    'hello',
  );
  assert.equal(mismatch.status, 0);
});

test('system-instructions aliases require one value and reject conflicts', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  const missing = run(configHome, 'chat', '--provider', 'gemini', '--gem');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--gem requires a value/);
  const missingBeforeOption = run(configHome, 'chat', '--gem', '--provider', 'gemini', 'hello');
  assert.notEqual(missingBeforeOption.status, 0);
  assert.match(missingBeforeOption.stderr, /--gem requires a value/);
  const conflict = run(
    configHome,
    'chat',
    '--provider',
    'gemini',
    '--gem',
    'one',
    '--gpt',
    'two',
    'hello',
  );
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /Conflicting options/);
});

test('system-instructions aliases are documented and omitted selection is unchanged', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'llmchat-cli-'));
  const help = run(configHome, 'chat', '--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--gem/);
  assert.match(help.stdout, /--gpt/);
  assert.match(help.stdout, /--system-instructions/);
  const withoutSelection = run(configHome, 'chat', '--provider', 'gemini', 'hello');
  assert.equal(withoutSelection.status, 0);
  assert.doesNotMatch(withoutSelection.stdout, /using system instructions/);
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
