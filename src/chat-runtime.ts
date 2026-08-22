import {
  type AdapterContext,
  type ProviderAdapter,
  type TimeoutOptions,
} from './adapter-contract.js';
import type { ProviderStoragePaths } from './data-path.js';
import type { BrowserSessionResult } from './browser-session.js';
import type { ExecutionTranscript } from './execution-transcript.js';

export type ChatRuntime = {
  adapterFor(provider: string): ProviderAdapter;
  contextFor(provider: string): AdapterContext;
  ensureSession?(
    provider: string,
    context: AdapterContext,
    options?: { visible?: boolean; interactive?: boolean },
  ): Promise<BrowserSessionResult>;
  releaseContext?(context: AdapterContext): void | Promise<void>;
  recordChat?(provider: string, transcript: ExecutionTranscript): void | Promise<void>;
  capabilitiesFor?(provider: string): ProviderCapabilities;
  timeout: TimeoutOptions;
};

export type ProviderCapabilities = {
  authentication: 'interactive' | 'none';
  browserSession: boolean;
};

export type StorageProvisioner = (provider: string) => ProviderStoragePaths;

export function adapterForProvider(
  provider: string,
  gemini: ProviderAdapter,
  demo: ProviderAdapter,
): ProviderAdapter {
  return provider === 'demo' ? demo : gemini;
}

export function capabilitiesForProvider(provider: string): ProviderCapabilities {
  if (provider === 'demo') return { authentication: 'none', browserSession: false };
  return { authentication: 'interactive', browserSession: true };
}
