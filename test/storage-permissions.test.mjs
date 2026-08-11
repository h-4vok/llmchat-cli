import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { appendDiagnosticLog, ensureProviderStorage } from '../dist/secure-storage.js';
import { createStorageFileSystem } from '../dist/storage-file-system.js';

function storageInput(platform) {
  if (platform === 'win32') {
    return { platform, home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Local' } };
  }
  return { platform, home: '/home/me', env: { XDG_DATA_HOME: '/data' } };
}

function existingLog() {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-existing-log-'));
  const log = join(root, 'llmchat', 'logs', 'gemini', 'diagnostic.log');
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, 'original\n');
  return { root, log };
}

function realOptions(root, secureFile) {
  return {
    input: { platform: 'win32', home: root, env: { LOCALAPPDATA: root } },
    accessControl: { secureDirectory: () => true, secureFile },
  };
}

test('failed pre-write ACL verification leaves an existing log unchanged', () => {
  const { root, log } = existingLog();

  assert.throws(
    () =>
      appendDiagnosticLog(
        'gemini',
        { message: 'never written' },
        realOptions(root, () => false),
      ),
    /Unable to verify user-only access/,
  );
  assert.equal(readFileSync(log, 'utf8'), 'original\n');
});

test('successful append verifies the real log both before and after writing', () => {
  const { root, log } = existingLog();
  const observedContent = [];
  const secureFile = (path) => (observedContent.push(readFileSync(path, 'utf8')), true);

  appendDiagnosticLog('gemini', { message: 'new bytes' }, realOptions(root, secureFile));

  assert.equal(observedContent.length, 2);
  assert.equal(observedContent[0], 'original\n');
  assert.match(observedContent[1], /^original\n.*new bytes/);
  assert.equal(readFileSync(log, 'utf8'), observedContent[1]);
});

test('POSIX chmod observes a real existing log before and after append', () => {
  const { root, log } = existingLog();
  const observedContent = [];
  const fileSystem = createStorageFileSystem({
    chmod(path, mode) {
      if (path === log) observedContent.push(readFileSync(path, 'utf8'));
      chmodSync(path, mode);
    },
  });

  appendDiagnosticLog(
    'gemini',
    { message: 'new bytes' },
    {
      input: { platform: 'linux', home: root, env: { XDG_DATA_HOME: root } },
      fileSystem,
    },
  );

  assert.equal(observedContent[0], 'original\n');
  assert.match(observedContent[1], /^original\n.*new bytes/);
  assert.equal(observedContent.length, 2);
});

test('storage fails closed when Windows ACL verification fails', () => {
  const fileSystem = { mkdir() {}, chmod() {}, appendFileSafely() {}, writeFile() {} };
  assert.throws(
    () =>
      ensureProviderStorage('gemini', {
        input: storageInput('win32'),
        fileSystem,
        accessControl: { secureDirectory: () => false, secureFile: () => false },
      }),
    /Unable to verify user-only access/,
  );
});
