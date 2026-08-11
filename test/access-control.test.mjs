import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createWindowsAccessControl,
  nodeWindowsAccessControl,
} from '../dist/windows-access-control.js';
import { inspectWindowsAcl } from '../test-support/windows-acl-inspector.mjs';

test('Windows ACL transports spaced paths as script parameters', () => {
  const calls = [];
  const access = createWindowsAccessControl({
    runScript(script, parameters) {
      calls.push({ script, parameters });
      return { status: 0, stdout: 'LLMCHAT_ACL_OK', stderr: '' };
    },
  });

  assert.equal(access.secureDirectory('C:\\Local Data\\profiles'), true);
  assert.equal(access.secureFile('C:\\Local Data\\diagnostic log.txt'), true);
  assert.ok(calls.every(({ script }) => script.includes('param(')));
  assert.deepEqual(
    calls.map(({ parameters }) => parameters),
    [
      ['C:\\Local Data\\profiles', 'directory'],
      ['C:\\Local Data\\diagnostic log.txt', 'file'],
    ],
  );
});

test('Windows ACL verification failure is reported', () => {
  const access = createWindowsAccessControl({
    runScript() {
      return { status: 3, stdout: '', stderr: 'verification failed' };
    },
  });

  assert.equal(access.secureDirectory('C:\\Local\\profiles'), false);
  assert.equal(access.secureFile('C:\\Local\\diagnostic.log'), false);
});

test(
  'native Windows ACL secures and verifies directory and file paths containing spaces',
  { skip: process.platform !== 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'llmchat acl native '));
    const directory = join(root, 'profile with spaces');
    const file = join(directory, 'diagnostic with spaces.log');
    mkdirSync(directory);
    writeFileSync(file, 'diagnostic');

    try {
      assert.equal(nodeWindowsAccessControl.secureDirectory(directory), true);
      assert.equal(nodeWindowsAccessControl.secureFile(file), true);
      const directoryAcl = inspectWindowsAcl(directory, 'directory');
      const fileAcl = inspectWindowsAcl(file, 'file');
      assert.deepEqual(
        [directoryAcl, fileAcl].map((acl) => ({
          protected: acl.protected,
          ruleCount: acl.ruleCount,
          currentIdentityOnly: acl.currentIdentityOnly,
          allowOnly: acl.allowOnly,
          fullControl: acl.fullControl,
          inheritanceCorrect: acl.inheritanceCorrect,
          propagationCorrect: acl.propagationCorrect,
        })),
        [directoryAcl, fileAcl].map(() => ({
          protected: true,
          ruleCount: 1,
          currentIdentityOnly: true,
          allowOnly: true,
          fullControl: true,
          inheritanceCorrect: true,
          propagationCorrect: true,
        })),
      );
      assert.equal(directoryAcl.inheritance, 'ContainerInherit, ObjectInherit');
      assert.equal(fileAcl.inheritance, 'None');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
