import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { nodeWindowsAccessControl } from '../../dist/windows-access-control.js';
import { inspectWindowsAcl } from '../../test-support/windows-acl-inspector.mjs';

test(
  'native Windows ACL secures new and pre-existing local-app-data paths without elevation',
  { skip: process.platform !== 'win32' },
  () => {
    assert.ok(process.env.LOCALAPPDATA);
    const root = mkdtempSync(join(process.env.LOCALAPPDATA, 'llmchat acl runtime '));
    const directory = join(root, 'profile with spaces');
    const file = join(directory, 'diagnostic with spaces.log');
    mkdirSync(directory);
    writeFileSync(file, 'diagnostic');

    try {
      assert.equal(nodeWindowsAccessControl.secureDirectory(directory), true);
      assert.equal(nodeWindowsAccessControl.secureFile(file), true);
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
