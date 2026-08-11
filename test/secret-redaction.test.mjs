import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactSessionSecrets } from '../dist/secret-redaction.js';

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
    'token=query-secret&safe=visible',
    'cookie=first-secret; cookie=second-secret; safe=still-visible',
    'Cookie: first=header-secret; second=another-secret',
  ].join('\n');

  assert.equal(
    redactSessionSecrets(input),
    [
      'authorization: Basic [REDACTED]',
      'token=[REDACTED]&safe=visible',
      'cookie=[REDACTED]; cookie=[REDACTED]; safe=still-visible',
      'Cookie: [REDACTED]',
    ].join('\n'),
  );
});
