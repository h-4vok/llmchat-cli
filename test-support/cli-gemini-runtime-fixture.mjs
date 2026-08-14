export const geminiContext = {
  profileDirectory: 'profiles/gemini',
  diagnosticsDirectory: 'diagnostics/gemini',
  screenshotsDirectory: 'screenshots/gemini',
  configuration: {},
  notify() {},
};

export function geminiRuntimeFixture(
  session = { status: 'ready', source: 'reused' },
  health = { status: 'healthy', message: 'ready' },
) {
  const calls = [];
  const adapter = {
    provider: 'gemini',
    async executeChat(request) {
      calls.push(['execute', request]);
      return { text: 'answer' };
    },
    async diagnose() {
      return { state: 'progress', message: 'ready' };
    },
    async checkHealth() {
      calls.push(['health']);
      return health;
    },
  };
  return {
    calls,
    runtime: {
      contextFor(provider) {
        calls.push(['context', provider]);
        return geminiContext;
      },
      async ensureSession(provider, received) {
        calls.push(['session', provider, received]);
        return session;
      },
      adapterFor(provider) {
        calls.push(['adapter', provider]);
        return adapter;
      },
      timeout: { timeoutMs: 10, schedule: () => () => {} },
    },
  };
}
