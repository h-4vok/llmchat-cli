const defaultPaths = {
  profileDirectory: '/fake/profiles/provider',
  diagnosticsDirectory: '/fake/diagnostics/provider',
  screenshotsDirectory: '/fake/screenshots/provider',
};

export function createFakeChatRuntime(provisionStorage = () => defaultPaths) {
  return {
    adapterFor: (provider) => fakeAdapter(provider),
    contextFor(provider) {
      const paths = provisionStorage(provider);
      return {
        profileDirectory: paths.profileDirectory,
        diagnosticsDirectory: paths.diagnosticsDirectory,
        screenshotsDirectory: paths.screenshotsDirectory ?? '',
        configuration: {},
        notify() {},
      };
    },
    async ensureSession() {
      return { status: 'ready', source: 'reused' };
    },
    timeout: { timeoutMs: 10_000 },
  };
}

function fakeAdapter(provider) {
  return {
    provider,
    async executeChat(request) {
      return { text: fakeResponse(provider, request) };
    },
    async diagnose() {
      return { state: 'progress', message: 'Fake provider is ready.' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'Fake provider is ready.' };
    },
  };
}

function fakeResponse(provider, request) {
  const instructions = request.systemInstructions
    ? ` using system instructions ${JSON.stringify(request.systemInstructions)}`
    : '';
  const reasoning = request.reasoning
    ? ` using reasoning ${JSON.stringify(request.reasoning)}`
    : '';
  return `Fake response from ${provider}${instructions}${reasoning}: ${request.prompt}`;
}
