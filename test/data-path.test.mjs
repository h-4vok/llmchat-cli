import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { dataRoot, providerStoragePaths } from '../dist/data-path.js';

test('local data roots follow each supported Node platform convention', () => {
  assert.equal(
    dataRoot({ platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'D:\\Local' } }),
    join('D:\\Local', 'llmchat'),
  );
  assert.equal(
    dataRoot({ platform: 'win32', home: 'C:\\Users\\me', env: {} }),
    join('C:\\Users\\me', 'AppData', 'Local', 'llmchat'),
  );
  assert.equal(
    dataRoot({ platform: 'darwin', home: '/Users/me', env: {} }),
    join('/Users/me', 'Library', 'Application Support', 'llmchat'),
  );
  assert.equal(
    dataRoot({ platform: 'linux', home: '/home/me', env: { XDG_DATA_HOME: '/data' } }),
    join('/data', 'llmchat'),
  );
  assert.equal(
    dataRoot({ platform: 'linux', home: '/home/me', env: {} }),
    join('/home/me', '.local', 'share', 'llmchat'),
  );
  assert.match(dataRoot(), /llmchat$/);
});

test('provider storage is isolated and rejects path-like provider identifiers', () => {
  const input = { platform: 'linux', home: '/home/me', env: {} };
  const gemini = providerStoragePaths('gemini', input);
  const chatgpt = providerStoragePaths('chatgpt', input);

  assert.equal(gemini.profileDirectory, join(gemini.root, 'profiles', 'gemini'));
  assert.equal(chatgpt.profileDirectory, join(chatgpt.root, 'profiles', 'chatgpt'));
  assert.notEqual(gemini.logsDirectory, chatgpt.logsDirectory);
  assert.notEqual(gemini.diagnosticsDirectory, chatgpt.diagnosticsDirectory);
  assert.notEqual(gemini.screenshotsDirectory, chatgpt.screenshotsDirectory);
  assert.throws(() => providerStoragePaths('../personal-profile', input), /provider identifier/i);
});

test('local data roots reject empty and relative environment or home paths', () => {
  const invalidInputs = [
    { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: '' } },
    { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'relative' } },
    { platform: 'linux', home: '/home/me', env: { XDG_DATA_HOME: '   ' } },
    { platform: 'linux', home: '/home/me', env: { XDG_DATA_HOME: 'relative' } },
    { platform: 'darwin', home: '', env: {} },
    { platform: 'linux', home: 'relative', env: {} },
  ];

  for (const input of invalidInputs) {
    assert.throws(() => dataRoot(input), /absolute local data path/i);
  }
});
