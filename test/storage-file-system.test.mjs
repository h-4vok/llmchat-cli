import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStorageFileSystem, nodeFileSystem } from '../dist/storage-file-system.js';

test('secure append rejects a reported symbolic link before opening it', () => {
  let opened = false;
  const fileSystem = createStorageFileSystem({
    exists: () => true,
    lstat: () => ({ isSymbolicLink: () => true }),
    open() {
      opened = true;
    },
  });

  assert.throws(
    () =>
      fileSystem.appendFileSafely('diagnostic.log', 'secret', {
        encoding: 'utf8',
        mode: 0o600,
        beforeWrite() {},
        afterWrite() {},
      }),
    /Refusing to append through symbolic link/,
  );
  assert.equal(opened, false);
});

test('secure append refuses a native symbolic link without modifying its target', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-symlink-'));
  const target = join(root, 'target.log');
  const link = join(root, 'diagnostic.log');
  writeFileSync(target, 'original');
  try {
    symlinkSync(target, link);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    const code = error?.code;
    if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(code)) throw error;
    context.skip(`native symbolic links unavailable: ${code}`);
    return;
  }

  try {
    assert.throws(() =>
      nodeFileSystem.appendFileSafely(link, 'malicious append', {
        encoding: 'utf8',
        mode: 0o600,
        beforeWrite() {},
        afterWrite() {},
      }),
    );
    assert.equal(readFileSync(target, 'utf8'), 'original');
  } finally {
    unlinkSync(link, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
