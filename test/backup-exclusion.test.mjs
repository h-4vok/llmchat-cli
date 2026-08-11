import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlatformBackupExclusion } from '../dist/backup-exclusion.js';

function runner(results) {
  const calls = [];
  return {
    calls,
    commandRunner: {
      run(command, args) {
        calls.push({ command, args });
        return results.shift();
      },
    },
  };
}

test('macOS backup exclusion applies and verifies Time Machine state', () => {
  const fake = runner([
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '[Excluded] /data/llmchat', stderr: '' },
  ]);
  const exclusion = createPlatformBackupExclusion(fake.commandRunner);

  assert.equal(exclusion.excludeAndVerify('/data/llmchat', 'darwin'), true);
  assert.deepEqual(fake.calls, [
    { command: 'tmutil', args: ['addexclusion', '/data/llmchat'] },
    { command: 'tmutil', args: ['isexcluded', '/data/llmchat'] },
  ]);
});

test('macOS verifies only the canonical requested root amid mixed output', () => {
  const exact = runner([
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '[Excluded] /data/llmchat', stderr: '' },
  ]);
  const foreign = runner([
    { status: 0, stdout: '', stderr: '' },
    {
      status: 0,
      stdout: '[Excluded] /data/llmchat-other\n[Included] /data/llmchat',
      stderr: '',
    },
  ]);

  assert.equal(
    createPlatformBackupExclusion(exact.commandRunner).excludeAndVerify(
      '/data/../data/llmchat',
      'darwin',
    ),
    true,
  );
  assert.deepEqual(
    exact.calls.map(({ args }) => args[1]),
    ['/data/llmchat', '/data/llmchat'],
  );
  assert.equal(
    createPlatformBackupExclusion(foreign.commandRunner).excludeAndVerify(
      '/data/llmchat',
      'darwin',
    ),
    false,
  );
});

test('macOS backup exclusion rejects failed application or verification', () => {
  const applyFailure = runner([{ status: 1, stdout: '', stderr: 'denied' }]);
  const verificationFailure = runner([
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '[Included] /data/llmchat', stderr: '' },
  ]);

  assert.equal(
    createPlatformBackupExclusion(applyFailure.commandRunner).excludeAndVerify(
      '/data/llmchat',
      'darwin',
    ),
    false,
  );
  assert.equal(
    createPlatformBackupExclusion(verificationFailure.commandRunner).excludeAndVerify(
      '/data/llmchat',
      'darwin',
    ),
    false,
  );
});

test('platforms without a secure backup mechanism fail closed', () => {
  const fake = runner([]);
  const exclusion = createPlatformBackupExclusion(fake.commandRunner);

  for (const platform of ['win32', 'linux']) {
    assert.throws(
      () => exclusion.excludeAndVerify('/data/llmchat', platform),
      new RegExp(`No secure backup exclusion mechanism.*${platform}`, 'i'),
    );
  }
  assert.deepEqual(fake.calls, []);
});
