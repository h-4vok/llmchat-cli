import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { configPath } from '../dist/config-path.js';

const home = 'C:/home';

test('configPath uses LOCALAPPDATA on Windows', () => {
  assert.equal(
    configPath({ platform: 'win32', home, env: { LOCALAPPDATA: 'C:/local' } }),
    join('C:/local', 'llmchat', 'config.json'),
  );
});

test('configPath falls back to the Windows local app-data directory', () => {
  assert.equal(
    configPath({ platform: 'win32', home, env: {} }),
    join('C:/home', 'AppData', 'Local', 'llmchat', 'config.json'),
  );
});

test('configPath uses the macOS application support directory', () => {
  assert.equal(
    configPath({ platform: 'darwin', home, env: {} }),
    join('C:/home', 'Library', 'Application Support', 'llmchat', 'config.json'),
  );
});

test('configPath uses XDG_CONFIG_HOME before the Linux home directory', () => {
  assert.equal(
    configPath({ platform: 'linux', home, env: { XDG_CONFIG_HOME: 'C:/xdg' } }),
    join('C:/xdg', 'llmchat', 'config.json'),
  );
});

test('configPath falls back to the Linux config directory', () => {
  assert.equal(
    configPath({ platform: 'linux', home, env: {} }),
    join('C:/home', '.config', 'llmchat', 'config.json'),
  );
});
