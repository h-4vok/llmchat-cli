import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureProviderStorage } from '../dist/secure-storage.js';

const platformInputs = [
  { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Local Data' } },
  { platform: 'darwin', home: '/Users/me', env: {} },
  { platform: 'linux', home: '/home/me', env: { XDG_DATA_HOME: '/home/me/.local/share' } },
];

test('provider storage is created on every platform without a backup runner', () => {
  const fileSystem = {
    mkdir() {},
    chmod() {},
    appendFileSafely() {},
    writeFile() {},
  };
  const accessControl = { secureDirectory: () => true, secureFile: () => true };

  for (const input of platformInputs) {
    const paths = ensureProviderStorage('gemini', { input, fileSystem, accessControl });
    assert.match(paths.profileDirectory, /profiles.+gemini/);
  }
});
