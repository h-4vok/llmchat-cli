export type DiagnosticCaptureSurface =
  'provider-viewport' | 'authentication-dialog' | 'devtools' | 'browser-internals';

export const diagnosticCapturePolicy = Object.freeze({
  allowedSurface: storageConfig.capture.providerViewport,
  deniedSurfaces: Object.freeze([
    'authentication-dialog',
    'devtools',
    'browser-internals',
  ] satisfies DiagnosticCaptureSurface[]),
});

export function isDiagnosticCaptureAllowed(surface: string): boolean {
  return surface === diagnosticCapturePolicy.allowedSurface;
}
import { storageConfig } from './config/storage.js';
