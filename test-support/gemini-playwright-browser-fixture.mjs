import { createPlaywrightGeminiBrowser } from '../dist/gemini-playwright-browser.js';

export const geminiAdapterContext = {
  profileDirectory: '/profiles/gemini',
  diagnosticsDirectory: '/diagnostics/gemini',
  screenshotsDirectory: '/screenshots/gemini',
  configuration: {},
  notify() {},
};

function page(state, navigationFailure, composerDelay = 0) {
  let currentState = state;
  let visibilityChecks = 0;
  return {
    async goto() {
      const failure = navigationFailure();
      if (failure !== undefined) throw failure;
    },
    locator(selector) {
      return {
        first() {
          return this;
        },
        async isVisible() {
          visibilityChecks += 1;
          if (selector.includes('composer') && visibilityChecks <= composerDelay) return false;
          return visibleState(selector, currentState);
        },
        async fill() {
          if (currentState === 'composer-only') currentState = 'validated';
        },
      };
    },
    url: () => 'https://gemini.google.com/app',
    isClosed: () => state === 'closed',
    async waitForTimeout() {},
    async screenshot() {
      return new Uint8Array([4]);
    },
  };
}

function visibleState(selector, state) {
  if (selector.includes('send')) return ['ready', 'validated'].includes(state);
  if (selector.includes('model')) return !['broken', 'model-broken'].includes(state);
  return state !== 'broken';
}

export function playwrightGeminiBrowserFixture(
  initialState = 'ready',
  composerDelay = 0,
  fixtureOptions = {},
) {
  const calls = [];
  const artifacts = [];
  let navigationFailure;
  const providerPage = (state) => page(state, () => navigationFailure, composerDelay);
  const contexts = ['open', 'healthy', 'broken'].map((name, index) => ({
    pages: () => (index === 1 ? [] : [providerPage(index === 2 ? 'broken' : initialState)]),
    async newPage() {
      calls.push('new-page');
      return providerPage('ready');
    },
    async close() {
      if (fixtureOptions.closeFailure) throw new Error('close failed');
      calls.push(`close-${name}`);
    },
  }));
  const options = {
    platform: 'linux',
    env: {},
    chromium: {
      executablePath: () => process.execPath,
      async launchPersistentContext(profile, launchOptions) {
        calls.push(['launch', profile, launchOptions]);
        return contexts.shift();
      },
    },
    saveDiagnostic(provider, content) {
      if (fixtureOptions.artifactFailure) throw new Error('artifact failed');
      artifacts.push(['diagnostic', provider, content]);
    },
    saveScreenshot(provider, content) {
      artifacts.push(['screenshot', provider, [...content]]);
    },
  };
  return {
    artifacts,
    browser: createPlaywrightGeminiBrowser({ send: async () => {} }, options),
    calls,
    failNavigation: (failure) => (navigationFailure = failure),
  };
}
