import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPersistentProfileAllocator } from '../dist/persistent-profile-allocation.js';
import { createPlaywrightBrowserLauncher } from '../dist/playwright-browser-launcher.js';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-profile-allocation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stable = join(root, 'profiles', 'gemini');
  mkdirSync(stable, { recursive: true });
  return stable;
}

test('real exclusive locks allocate stable then persistent concurrent profile slots', (t) => {
  const stable = workspace(t);
  const firstAllocator = createPersistentProfileAllocator();
  const secondAllocator = createPersistentProfileAllocator();
  const stableLease = firstAllocator.acquire(stable);
  const concurrentLease = secondAllocator.acquire(stable);

  assert.equal(stableLease.profileDirectory, stable);
  assert.equal(concurrentLease.profileDirectory, `${stable}.concurrent-1`);
  mkdirSync(concurrentLease.profileDirectory, { recursive: true });
  writeFileSync(join(concurrentLease.profileDirectory, 'persistent-marker'), 'slot session');
  concurrentLease.release();
  const reusedConcurrent = firstAllocator.acquire(stable);
  assert.equal(reusedConcurrent.profileDirectory, concurrentLease.profileDirectory);
  assert.equal(existsSync(join(reusedConcurrent.profileDirectory, 'persistent-marker')), true);

  reusedConcurrent.release();
  reusedConcurrent.release();
  stableLease.release();
  const sequential = firstAllocator.acquire(stable);
  assert.equal(sequential.profileDirectory, stable);
  sequential.release();
});

test('allocation failures other than an occupied lock fail clearly', (t) => {
  const root = workspace(t);
  const blockingFile = join(root, 'not-a-directory');
  writeFileSync(blockingFile, 'block nested directories');
  assert.throws(
    () => createPersistentProfileAllocator().acquire(join(blockingFile, 'gemini')),
    /ENOENT|ENOTDIR|EEXIST/,
  );

  const denied = Object.assign(new Error('lock denied'), { code: 'EACCES' });
  const fileSystem = {
    mkdir(path) {
      if (path.endsWith('.lease-0')) throw denied;
    },
    chmod() {},
    rmdir() {},
  };
  assert.throws(() => createPersistentProfileAllocator(fileSystem).acquire(root), denied);
});

test('derived concurrent profile is the real persistent launch argument', async (t) => {
  const stable = workspace(t);
  const allocator = createPersistentProfileAllocator();
  const occupied = allocator.acquire(stable);
  const lease = allocator.acquire(stable);
  const calls = [];
  const page = {
    goto: async () => {},
    isClosed: () => false,
    url: () => 'https://gemini.google.com/app',
    locator: () => ({
      first() {
        return this;
      },
      isVisible: async () => true,
    }),
    screenshot: async () => new Uint8Array(),
  };
  const launcher = createPlaywrightBrowserLauncher({
    platform: 'linux',
    env: {},
    chromium: {
      executablePath: () => process.execPath,
      async launchPersistentContext(profileDirectory, options) {
        calls.push([profileDirectory, options]);
        return { pages: () => [page], close: async () => {} };
      },
    },
    saveDiagnostic: () => {},
    saveScreenshot: () => {},
  });
  const browser = await launcher.open({
    provider: 'gemini',
    profileDirectory: lease.profileDirectory,
    visible: true,
  });

  assert.deepEqual(calls[0], [
    `${stable}.concurrent-1`,
    { executablePath: process.execPath, headless: false },
  ]);
  await browser.close();
  lease.release();
  occupied.release();
});
