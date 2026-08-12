import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REDACTION_MARKER,
  redactDiagnosticText,
  redactSessionSecrets,
} from '../dist/secret-redaction.js';

test('the diagnostic API keeps the legacy entry point and a stable marker', () => {
  assert.equal(REDACTION_MARKER, '[REDACTED]');
  assert.equal(redactDiagnosticText('token=hidden'), 'token=[REDACTED]');
  assert.equal(redactSessionSecrets('token=hidden'), 'token=[REDACTED]');
});

test('nested JSON redacts sensitive values and objects while preserving safe data', () => {
  const input = JSON.stringify({
    safe: { visible: 'keep-me' },
    nested: {
      cookie: { value: 'cookie-secret', domain: 'example.test' },
      credentials: { password: 'password-secret', user: 'private-user' },
      metadata: { token: 'token-secret', label: 'keep-label' },
      list: [{ api_key: 'array-secret', safe: 'keep-array' }],
    },
  });

  const redacted = JSON.parse(redactSessionSecrets(input));

  assert.deepEqual(redacted.safe, { visible: 'keep-me' });
  assert.equal(redacted.nested.cookie, '[REDACTED]');
  assert.equal(redacted.nested.credentials, '[REDACTED]');
  assert.equal(redacted.nested.metadata.token, '[REDACTED]');
  assert.equal(redacted.nested.metadata.label, 'keep-label');
  assert.deepEqual(redacted.nested.list, [{ api_key: '[REDACTED]', safe: 'keep-array' }]);
  assert.doesNotMatch(
    JSON.stringify(redacted),
    /cookie-secret|password-secret|private-user|token-secret|array-secret/,
  );
});

test('assignments redact only secret values and complete cookie headers', () => {
  const input = [
    'authorization: Basic basic-secret',
    'authorization=opaque-secret; safe=visible',
    'token=query-secret&safe=visible',
    'cookie=first-secret; cookie=second-secret; safe=still-visible',
    'Cookie: first=header-secret; second=another-secret',
  ].join('\n');

  assert.equal(
    redactSessionSecrets(input),
    [
      'authorization: Basic [REDACTED]',
      'authorization=[REDACTED]; safe=visible',
      'token=[REDACTED]&safe=visible',
      'cookie=[REDACTED]; cookie=[REDACTED]; safe=still-visible',
      'Cookie: [REDACTED]',
    ].join('\n'),
  );
});

test('authentication schemes redact credentials without an authorization label', () => {
  const input = [
    'Basic dXNlcjpwYXNz; request=login',
    'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature; request=chat',
    'Digest username="user", realm="private", nonce="nonce", response="digest"; request=retry',
  ].join('\n');

  assert.equal(
    redactDiagnosticText(input),
    [
      'Basic [REDACTED]; request=login',
      'Bearer [REDACTED]; request=chat',
      'Digest [REDACTED]; request=retry',
    ].join('\n'),
  );
});

test('repeated authorization and cookie headers are independently redacted', () => {
  const input = [
    'Authorization: Bearer first-token',
    'Proxy-Authorization: Digest username="user", response="first-response"',
    'Cookie: sid=first-cookie; theme=dark',
    'Set-Cookie: sid=second-cookie; Secure; HttpOnly',
    'cookie: sid=third-cookie',
    'status: retryable',
  ].join('\n');

  assert.equal(
    redactDiagnosticText(input),
    [
      'Authorization: Bearer [REDACTED]',
      'Proxy-Authorization: Digest [REDACTED]',
      'Cookie: [REDACTED]',
      'Set-Cookie: [REDACTED]',
      'cookie: [REDACTED]',
      'status: retryable',
    ].join('\n'),
  );
});

test('assignments and query strings preserve non-sensitive fields and fragments', () => {
  const input = [
    'https://example.test/callback?token=token-value&safe=visible&api-key=key-value#result',
    'password = password-value; mode=debug, client secret: client-value, api key=plain-key',
    'accessToken=access-value&refresh_token=refresh-value&token_budget=public',
  ].join('\n');

  assert.equal(
    redactDiagnosticText(input),
    [
      'https://example.test/callback?token=[REDACTED]&safe=visible&api-key=[REDACTED]#result',
      'password = [REDACTED]; mode=debug, client secret: [REDACTED], api key=[REDACTED]',
      'accessToken=[REDACTED]&refresh_token=[REDACTED]&token_budget=public',
    ].join('\n'),
  );
});

test('credential, session, secret, and id token values are redacted without hiding safe params', () => {
  const input =
    'credential=one&credentials=two&session=three&secret=four&id_token=five&safe=visible';
  assert.equal(
    redactDiagnosticText(input),
    'credential=[REDACTED]&credentials=[REDACTED]&session=[REDACTED]&secret=[REDACTED]&id_token=[REDACTED]&safe=visible',
  );
  assert.equal(
    redactDiagnosticText(
      '{"credential":"one","credentials":"two","session":"three","secret":"four","id_token":"five","safe":"visible"}',
    ),
    '{"credential":"[REDACTED]","credentials":"[REDACTED]","session":"[REDACTED]","secret":"[REDACTED]","id_token":"[REDACTED]","safe":"visible"}',
  );
});

test('embedded nested JSON is redacted without discarding surrounding diagnostics', () => {
  const input = [
    'request={"headers":{"Authorization":"Bearer json-token","Cookie":"sid=json-cookie"},"safe":"keep"}',
    'response=[{"client_secret":"json-client","status":"ok"}] elapsed=12ms',
  ].join(' ');

  assert.equal(
    redactDiagnosticText(input),
    [
      'request={"headers":{"Authorization":"[REDACTED]","Cookie":"[REDACTED]"},"safe":"keep"}',
      'response=[{"client_secret":"[REDACTED]","status":"ok"}] elapsed=12ms',
    ].join(' '),
  );
});

test('JSON string fields redact serialized fragments and retain safe prose', () => {
  const input = JSON.stringify({
    message: 'payload={"password":"deep-secret","safe":"deep-safe"}; outcome=retry',
    status: 'safe-status',
  });

  assert.deepEqual(JSON.parse(redactDiagnosticText(input)), {
    message: 'payload={"password":"[REDACTED]","safe":"deep-safe"}; outcome=retry',
    status: 'safe-status',
  });
});

test('JSON primitives and malformed fragments remain useful', () => {
  assert.equal(redactDiagnosticText('[null,42,true]'), '[null,42,true]');
  assert.equal(redactDiagnosticText('partial={not-json safe=true'), 'partial={not-json safe=true');
});
