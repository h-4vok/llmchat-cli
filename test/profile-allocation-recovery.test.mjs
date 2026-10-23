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
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createPersistentProfileAllocator } from '../dist/persistent-profile-allocation.js';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-profile-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stable = join(root, 'profiles', 'gemini');
  mkdirSync(stable, { recursive: true });
  return stable;
}

test('an abandoned lease is reclaimed when its recorded process is gone', (t) => {
  const stable = workspace(t);
  const lockDirectory = `${stable}.lease-0`;
  mkdirSync(lockDirectory);
  writeFileSync(join(lockDirectory, 'owner'), '4242');
  t.mock.method(process, 'kill', () => {
    throw Object.assign(new Error('process not found'), { code: 'ESRCH' });
  });

  const lease = createPersistentProfileAllocator().acquire(stable);
  try {
    assert.equal(lease.profileDirectory, stable);
  } finally {
    lease.release();
  }
});

test('a legacy lease without an owner fails instead of switching profiles', (t) => {
  const stable = workspace(t);
  mkdirSync(`${stable}.lease-0`);

  assert.throws(
    () => createPersistentProfileAllocator().acquire(stable),
    /lease has no owner metadata.*remove it only after confirming/i,
  );
});

test('a lease with invalid owner metadata fails clearly', (t) => {
  const stable = workspace(t);
  const lockDirectory = `${stable}.lease-0`;
  mkdirSync(lockDirectory);
  writeFileSync(join(lockDirectory, 'owner'), 'not-a-pid');

  assert.throws(
    () => createPersistentProfileAllocator().acquire(stable),
    /lease has no owner metadata/i,
  );
});

test('waits for owner metadata when another process is creating its lease', (t) => {
  const stable = workspace(t);
  const lockDirectory = `${stable}.lease-0`;
  mkdirSync(lockDirectory);
  const ownerPath = join(lockDirectory, 'owner');
  let firstRead = true;
  const fileSystem = {
    mkdir: mkdirSync,
    chmod: chmodSync,
    readFile(path, encoding) {
      if (resolve(path) === ownerPath && firstRead) {
        firstRead = false;
        writeFileSync(ownerPath, '4242');
        throw Object.assign(new Error('owner is not visible yet'), { code: 'ENOENT' });
      }
      return readFileSync(path, encoding);
    },
    rmdir: rmdirSync,
    unlink: unlinkSync,
    rename: renameSync,
    writeFile: writeFileSync,
  };

  const lease = createPersistentProfileAllocator(fileSystem, () => true).acquire(stable);
  try {
    assert.equal(lease.profileDirectory, `${stable}.concurrent-1`);
  } finally {
    lease.release();
  }
});

test('an owner process that cannot be inspected remains occupied', (t) => {
  const stable = workspace(t);
  const lockDirectory = `${stable}.lease-0`;
  mkdirSync(lockDirectory);
  writeFileSync(join(lockDirectory, 'owner'), '4242');
  t.mock.method(process, 'kill', () => {
    throw Object.assign(new Error('process access denied'), { code: 'EPERM' });
  });

  const lease = createPersistentProfileAllocator().acquire(stable);
  try {
    assert.equal(lease.profileDirectory, `${stable}.concurrent-1`);
  } finally {
    lease.release();
  }
});

test('a failed owner write removes the newly acquired lock', () => {
  const failure = new Error('owner write failed');
  let removals = 0;
  const fileSystem = {
    mkdir() {},
    chmod() {},
    readFile() {},
    rmdir() {
      removals += 1;
    },
    unlink() {},
    rename() {},
    writeFile() {
      throw failure;
    },
  };

  assert.throws(
    () => createPersistentProfileAllocator(fileSystem).acquire('/profiles/gemini'),
    failure,
  );
  assert.equal(removals, 1);
});
