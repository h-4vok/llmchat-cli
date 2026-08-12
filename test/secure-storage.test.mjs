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

const verifiedAccess = { secureDirectory: () => true, secureFile: () => true };

test('storage applies user-only modes without a backup integration', () => {
  const calls = { mkdir: [], chmod: [], writeFile: [] };
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
  });

  assert.equal(calls.mkdir.length, 5);
  assert.ok(calls.mkdir.every((call) => call.options.mode === 0o700));
  assert.deepEqual(
    calls.chmod,
    calls.mkdir.map(({ path }) => ({ path, mode: 0o700 })),
  );
  assert.deepEqual(calls.writeFile, []);
  assert.match(paths.root, /llmchat$/);

  calls.chmod.length = 0;
  ensureProviderStorage('gemini', {
    input: input('C:\\Local'),
    fileSystem,
    accessControl: verifiedAccess,
  });
  assert.deepEqual(calls.chmod, []);

  const currentPaths = ensureProviderStorage('gemini', {
    fileSystem,
    accessControl: verifiedAccess,
  });
  assert.match(currentPaths.root, /llmchat$/);

  const posixRoot = mkdtempSync(join(tmpdir(), 'llmchat-posix-modes-'));
  assert.doesNotThrow(() =>
    ensureProviderStorage('gemini', {
      input: input(posixRoot, 'linux'),
    }),
  );
});

test('diagnostic artifacts persist while session secrets are redacted', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-data-'));
  const options = {
    input: input(root),
    now: () => new Date('2026-08-11T12:34:56.000Z'),
    artifactId: () => 'artifact-1',
    accessControl: verifiedAccess,
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
  appendDiagnosticLog(
    'gemini',
    {
      message:
        'credential=one&credentials=two&session=three&secret=four&id_token=five&safe=visible',
    },
    options,
  );
  const diagnostic = saveDiagnostic('gemini', 'cookie=session-value', options);
  const screenshot = saveScreenshot('gemini', new Uint8Array([1, 2, 3]), options);
  const automaticName = saveDiagnostic('gemini', 'plain', {
    input: input(root),
    accessControl: verifiedAccess,
  });

  const logText = readFileSync(log, 'utf8');
  assert.match(logText, /Keep this prompt/);
  assert.match(logText, /Keep this response/);
  assert.match(logText, /second entry/);
  assert.match(
    logText,
    /credential=\[REDACTED\]&credentials=\[REDACTED\]&session=\[REDACTED\]&secret=\[REDACTED\]&id_token=\[REDACTED\]&safe=visible/,
  );
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
