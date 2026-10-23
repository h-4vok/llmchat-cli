import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPersistentProfileAllocator } from '../dist/persistent-profile-allocation.js';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-profile-race-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stable = join(root, 'profiles', 'gemini');
  mkdirSync(stable, { recursive: true });
  return stable;
}

test('competing reclaimers never acquire the same stable profile', (t) => {
  const stable = workspace(t);
  const lockDirectory = `${stable}.lease-0`;
  mkdirSync(lockDirectory);
  writeFileSync(join(lockDirectory, 'owner'), '4242');
  let secondLease;
  const fileSystem = {
    mkdir: mkdirSync,
    chmod: chmodSync,
    readFile: readFileSync,
    rmdir: rmdirSync,
    unlink: unlinkSync,
    writeFile: writeFileSync,
    rename(from, to) {
      renameSync(from, to);
      secondLease = createPersistentProfileAllocator().acquire(stable);
    },
  };

  const firstLease = createPersistentProfileAllocator(fileSystem, () => false).acquire(stable);
  try {
    assert.equal(firstLease.profileDirectory, `${stable}.concurrent-1`);
    assert.equal(secondLease.profileDirectory, stable);
  } finally {
    firstLease.release();
    secondLease?.release();
  }
});

test('a reclaimer that loses the rename race uses a concurrent profile', (t) => {
  for (const code of ['ENOENT', 'EEXIST']) {
    const stable = workspace(t);
    const lockDirectory = `${stable}.lease-0`;
    mkdirSync(lockDirectory);
    writeFileSync(join(lockDirectory, 'owner'), '4242');
    const fileSystem = {
      mkdir: mkdirSync,
      chmod: chmodSync,
      readFile: readFileSync,
      rmdir: rmdirSync,
      unlink: unlinkSync,
      writeFile: writeFileSync,
      rename() {
        throw Object.assign(new Error('claim already moved'), { code });
      },
    };

    const lease = createPersistentProfileAllocator(fileSystem, () => false).acquire(stable);
    try {
      assert.equal(lease.profileDirectory, `${stable}.concurrent-1`);
    } finally {
      lease.release();
    }
  }
});

test('a reclaimer preserves unexpected rename failures', (t) => {
  const stable = workspace(t);
  const lockDirectory = `${stable}.lease-0`;
  mkdirSync(lockDirectory);
  writeFileSync(join(lockDirectory, 'owner'), '4242');
  const fileSystem = {
    mkdir: mkdirSync,
    chmod: chmodSync,
    readFile: readFileSync,
    rmdir: rmdirSync,
    unlink: unlinkSync,
    writeFile: writeFileSync,
    rename() {
      throw Object.assign(new Error('rename denied'), { code: 'EACCES' });
    },
  };

  assert.throws(
    () => createPersistentProfileAllocator(fileSystem, () => false).acquire(stable),
    /rename denied/,
  );
});
