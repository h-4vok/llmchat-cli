import {
  type AdapterContext,
  type ProviderAdapter,
  type TimeoutOptions,
} from './adapter-contract.js';
import type { ProviderStoragePaths } from './data-path.js';
import type { BrowserSessionResult } from './browser-session.js';
import { sendChat } from './provider.js';
import { ensureProviderStorage } from './secure-storage.js';
import { runtimeConfig } from './config/runtime.js';

export type ChatRuntime = {
  adapterFor(provider: string): ProviderAdapter;
  contextFor(provider: string): AdapterContext;
  ensureSession?(provider: string, context: AdapterContext): Promise<BrowserSessionResult>;
  releaseContext?(context: AdapterContext): void | Promise<void>;
  timeout: TimeoutOptions;
};

export type StorageProvisioner = (provider: string) => ProviderStoragePaths;

const simulationAdapter: ProviderAdapter = {
  provider: 'gemini',
  async executeChat(request) {
    return { text: sendChat(this.provider, request) };
  },
  async diagnose() {
    return { state: 'progress', message: 'simulation is ready' };
  },
  async checkHealth() {
    return { status: 'healthy', message: 'simulation is ready' };
  },
};

export function createChatRuntime(
  provisionStorage: StorageProvisioner = ensureProviderStorage,
): ChatRuntime {
  return {
    adapterFor: () => simulationAdapter,
    async ensureSession() {
      return { status: 'ready', source: 'reused' };
    },
    contextFor(provider) {
      const paths = provisionStorage(provider);
      return {
        profileDirectory: paths.profileDirectory,
        diagnosticsDirectory: paths.diagnosticsDirectory,
        screenshotsDirectory: paths.screenshotsDirectory ?? '',
        configuration: {},
        notify: ignoreNotification,
      };
    },
    timeout: { timeoutMs: runtimeConfig.timeouts.geminiInactivityMs },
  };
}

export const defaultChatRuntime = createChatRuntime();

function ignoreNotification(): void {}
