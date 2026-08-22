import type { ProviderAdapter } from './adapter-contract.js';

export function createDemoAdapter(): ProviderAdapter {
  return {
    provider: 'demo',
    async executeChat(request) {
      if (request.keepBrowserOpen)
        throw new Error(
          'Provider demo does not use a browser; --keep-browser-open is unsupported.',
        );
      return { text: `Demo response: ${request.prompt}` };
    },
    async diagnose() {
      return { state: 'progress', message: 'Demo provider is ready.' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'Demo provider is ready.' };
    },
  };
}
