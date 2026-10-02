import assert from 'node:assert/strict';
import { test } from 'node:test';
import { environmentForCommand } from '../dist/command-environment.js';

test('Windows PowerShell discovers its own modules instead of inheriting another edition', () => {
  const env = {
    PATH: 'system-path',
    PSModulePath: 'PowerShell7-only-modules',
    TEMP: 'temporary-path',
  };
  const result = environmentForCommand('powershell.exe', env);
  assert.deepEqual(result, { PATH: 'system-path', TEMP: 'temporary-path' });
  assert.equal(env.PSModulePath, 'PowerShell7-only-modules');
});

test('other commands retain their module environment', () => {
  const env = { PSModulePath: 'custom-path' };
  assert.deepEqual(environmentForCommand('pwsh.exe', env), env);
  assert.deepEqual(environmentForCommand('node', env), env);
});

test('Windows PowerShell environment keys and executable names are case insensitive', () => {
  assert.deepEqual(
    environmentForCommand('C:\\Windows\\PowerShell.EXE', {
      PSMODULEPATH: 'foreign-modules',
      Path: 'system-path',
    }),
    { Path: 'system-path' },
  );
});
