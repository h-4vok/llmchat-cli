import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWindowsAccessControl } from '../dist/windows-access-control.js';

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
