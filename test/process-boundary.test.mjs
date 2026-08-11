import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPowerShellRunner, nodeCommandRunner } from '../dist/process-boundary.js';

test('the command boundary captures successful and missing local processes', () => {
  const success = nodeCommandRunner.run(process.execPath, [
    '-e',
    'process.stdout.write("command-ok")',
  ]);
  const missing = nodeCommandRunner.run('llmchat-command-that-does-not-exist', []);

  assert.equal(success.status, 0);
  assert.equal(success.stdout, 'command-ok');
  assert.equal(success.stderr, '');
  assert.equal(missing.status, null);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr, '');
});

test('PowerShell scripts and paths travel as separate process arguments', () => {
  let temporaryScript = '';
  const powerShell = createPowerShellRunner({
    run(command, args) {
      temporaryScript = args[3];
      assert.equal(command, 'powershell.exe');
      assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-File']);
      assert.equal(readFileSync(temporaryScript, 'utf8'), 'param($Target) $Target');
      assert.deepEqual(args.slice(4), ['C:\\path with spaces\\profile']);
      return { status: 0, stdout: 'verified', stderr: '' };
    },
  });

  const result = powerShell.runScript('param($Target) $Target', ['C:\\path with spaces\\profile']);

  assert.equal(result.stdout, 'verified');
  assert.equal(existsSync(temporaryScript), false);
});
