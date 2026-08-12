import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diagnosticCapturePolicy,
  isDiagnosticCaptureAllowed,
} from '../dist/diagnostic-redaction-policy.js';

test('diagnostic captures allow only the provider viewport', () => {
  assert.equal(diagnosticCapturePolicy.allowedSurface, 'provider-viewport');
  assert.equal(isDiagnosticCaptureAllowed('provider-viewport'), true);
  for (const surface of diagnosticCapturePolicy.deniedSurfaces) {
    assert.equal(isDiagnosticCaptureAllowed(surface), false, surface);
  }
  assert.equal(isDiagnosticCaptureAllowed('unknown-surface'), false);
});

test('the denied capture policy explicitly covers privileged browser surfaces', () => {
  assert.deepEqual(diagnosticCapturePolicy.deniedSurfaces, [
    'authentication-dialog',
    'devtools',
    'browser-internals',
  ]);
});
