import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendDiagnosticLog,
  ensureProviderStorage,
  saveDiagnostic,
  saveScreenshot,
} from '../dist/secure-storage.js';

function input(root, platform = 'win32') {
  const env = platform === 'win32' ? { LOCALAPPDATA: root } : { XDG_DATA_HOME: root };
  return { platform, home: root, env };
}

const verifiedBackup = { excludeAndVerify: () => true };
const verifiedAccess = { secureDirectory: () => true, secureFile: () => true };

test('storage applies user-only modes and verifies platform backup exclusion', () => {
  const calls = { mkdir: [], chmod: [], writeFile: [], backup: [] };
  const fileSystem = {
    mkdir(path, options) {
      calls.mkdir.push({ path, options });
    },
    chmod(path, mode) {
      calls.chmod.push({ path, mode });
    },
    appendFileSafely(_path, _content, options) {
      options.beforeWrite();
      options.afterWrite();
    },
    writeFile(path, content, options) {
      calls.writeFile.push({ path, content, options });
    },
  };

  const paths = ensureProviderStorage('gemini', {
    input: input('/data', 'linux'),
    fileSystem,
    backupExclusion: {
      excludeAndVerify(path, platform) {
        calls.backup.push({ path, platform });
        return true;
      },
    },
  });

  assert.equal(calls.mkdir.length, 5);
  assert.ok(calls.mkdir.every((call) => call.options.mode === 0o700));
  assert.deepEqual(
    calls.chmod,
    calls.mkdir.map(({ path }) => ({ path, mode: 0o700 })),
  );
  assert.deepEqual(calls.writeFile, []);
  assert.deepEqual(calls.backup, [{ path: paths.root, platform: 'linux' }]);

  calls.chmod.length = 0;
  ensureProviderStorage('gemini', {
    input: input('C:\\Local'),
    fileSystem,
    accessControl: verifiedAccess,
    backupExclusion: { excludeAndVerify: () => true },
  });
  assert.deepEqual(calls.chmod, []);

  const currentPaths = ensureProviderStorage('gemini', {
    fileSystem,
    accessControl: verifiedAccess,
    backupExclusion: { excludeAndVerify: () => true },
  });
  assert.match(currentPaths.root, /llmchat$/);

  const posixRoot = mkdtempSync(join(tmpdir(), 'llmchat-posix-modes-'));
  assert.doesNotThrow(() =>
    ensureProviderStorage('gemini', {
      input: input(posixRoot, 'linux'),
      backupExclusion: verifiedBackup,
    }),
  );

  assert.throws(
    () =>
      ensureProviderStorage('gemini', {
        input: input('/unsafe', 'linux'),
        fileSystem,
        backupExclusion: { excludeAndVerify: () => false },
      }),
    /Unable to verify backup exclusion/,
  );
});

test('diagnostic artifacts persist while session secrets are redacted', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-data-'));
  const options = {
    input: input(root),
    now: () => new Date('2026-08-11T12:34:56.000Z'),
    artifactId: () => 'artifact-1',
    accessControl: verifiedAccess,
    backupExclusion: verifiedBackup,
  };
  const log = appendDiagnosticLog(
    'gemini',
    {
      message: 'authorization: Bearer hidden',
      prompt: 'Keep this prompt; token=secret-token',
      response: 'Keep this response; password="secret-password"',
      cookie: 'must-not-be-serialized',
    },
    options,
  );
  appendDiagnosticLog('gemini', { message: 'second entry' }, options);
  const diagnostic = saveDiagnostic('gemini', 'cookie=session-value', options);
  const screenshot = saveScreenshot('gemini', new Uint8Array([1, 2, 3]), options);
  const automaticName = saveDiagnostic('gemini', 'plain', {
    input: input(root),
    accessControl: verifiedAccess,
    backupExclusion: verifiedBackup,
  });

  const logText = readFileSync(log, 'utf8');
  assert.match(logText, /Keep this prompt/);
  assert.match(logText, /Keep this response/);
  assert.match(logText, /second entry/);
  assert.doesNotMatch(logText, /hidden|secret-token|secret-password|must-not-be-serialized/);
  assert.equal(readFileSync(diagnostic, 'utf8'), 'cookie=[REDACTED]');
  assert.deepEqual(readFileSync(screenshot), Buffer.from([1, 2, 3]));
  assert.equal(readFileSync(automaticName, 'utf8'), 'plain');
});

test('text diagnostics redact structured secrets without masking ordinary prose', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-redaction-'));
  const content = [
    '{"token":"json-token","password":"json-password"}',
    'api_key=api-secret',
    'client_secret: client-secret',
    'Cookie: session=first-cookie; preference=second-cookie; theme=third-cookie',
    'Set-Cookie: session=fourth-cookie; Path=/; HttpOnly',
    'token budget, password policy, api_keynote=public, client_secretary=person',
  ].join('\n');
  const path = saveDiagnostic('gemini', content, {
    input: input(root),
    now: () => new Date('2026-08-11T12:34:56.000Z'),
    artifactId: () => 'structured',
    accessControl: verifiedAccess,
    backupExclusion: verifiedBackup,
  });

  const redacted = readFileSync(path, 'utf8');
  assert.doesNotMatch(
    redacted,
    /json-token|json-password|api-secret|client-secret|first-cookie|second-cookie|third-cookie|fourth-cookie/,
  );
  assert.match(redacted, /"token":"\[REDACTED\]"/);
  assert.match(redacted, /"password":"\[REDACTED\]"/);
  assert.match(redacted, /Cookie: \[REDACTED\]/);
  assert.match(redacted, /Set-Cookie: \[REDACTED\]/);
  assert.match(
    redacted,
    /token budget, password policy, api_keynote=public, client_secretary=person/,
  );
});
