import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { test } from 'node:test';

import { codexInvocation } from '../test-support/codex-invocation.mjs';

test('uses the Codex executable directly outside Windows', () => {
  assert.deepEqual(codexInvocation(['exec'], { platform: 'linux', env: {} }), {
    command: 'codex',
    args: ['exec'],
  });
});

test('launches the npm Codex JavaScript entrypoint safely on Windows', () => {
  const directory = 'C:\\Program Files\\nodejs';
  const shim = win32.join(directory, 'codex.cmd');
  const entrypoint = win32.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  const existing = new Set([shim, entrypoint]);

  assert.deepEqual(
    codexInvocation(['exec'], {
      platform: 'win32',
      env: { Path: `${directory};C:\\Windows` },
      exists: (path) => existing.has(path),
      node: 'C:\\node.exe',
    }),
    { command: 'C:\\node.exe', args: [entrypoint, 'exec'] },
  );
});

test('uses an explicit native CODEX_BIN unchanged', () => {
  assert.deepEqual(
    codexInvocation(['exec'], {
      override: 'C:\\tools\\codex.exe',
      platform: 'win32',
    }),
    { command: 'C:\\tools\\codex.exe', args: ['exec'] },
  );
});

test('launches an explicit JavaScript CODEX_BIN with Node', () => {
  assert.deepEqual(
    codexInvocation(['exec'], {
      override: 'C:\\tools\\codex.js',
      platform: 'win32',
      node: 'C:\\node.exe',
    }),
    { command: 'C:\\node.exe', args: ['C:\\tools\\codex.js', 'exec'] },
  );
});

test('resolves an explicit npm command shim without invoking a shell', () => {
  const shim = 'C:\\npm\\codex.cmd';
  const entrypoint = win32.join('C:\\npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

  assert.deepEqual(
    codexInvocation(['exec'], {
      override: shim,
      platform: 'win32',
      exists: (path) => path === entrypoint,
      node: 'C:\\node.exe',
    }),
    { command: 'C:\\node.exe', args: [entrypoint, 'exec'] },
  );
});

test('reports an actionable error when Windows has no safe Codex entrypoint', () => {
  assert.throws(
    () =>
      codexInvocation(['exec'], {
        platform: 'win32',
        env: { PATH: 'C:\\missing' },
        exists: () => false,
      }),
    /CODEX_BIN.*\.exe.*\.js/i,
  );
});
