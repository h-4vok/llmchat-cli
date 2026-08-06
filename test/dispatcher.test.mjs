import assert from 'node:assert/strict';
import { test } from 'node:test';
import { command, runCommand } from '../dist/dispatcher.js';

test('commands are argv-based and worker receives only the issue id', () => {
  assert.deepEqual(command(['node', '-e', 'process.exit(0)'], 42, true), {
    command: 'node',
    args: ['-e', 'process.exit(0)', '42'],
    timeoutMs: 120000,
    retries: 0,
  });
  assert.throws(() => command({ command: 'node; malicious' }, 1), /shell operators/);
});

test('command failures retry and then surface a useful error', () => {
  const spec = command({ command: 'node', args: ['-e', 'process.exit(2)'], retries: 1 }, 0);
  assert.throws(() => runCommand(spec), /failed after 2 attempt/);
});

test('successful commands execute without a shell', () => {
  runCommand(command({ command: 'node', args: ['-e', 'process.exit(0)'], timeoutMs: 1000 }, 0));
});
