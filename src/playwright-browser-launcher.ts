import { chromium, type BrowserContext, type Page } from 'playwright';
import { browserCandidates, discoverBrowserExecutable } from './browser-executable.js';
import type {
  PersistentBrowserLauncher,
  PersistentBrowserObservation,
  PersistentBrowserRequest,
  PersistentBrowserWindow,
} from './persistent-browser-session.js';
import { persistGeminiFailure } from './gemini-failure-artifacts.js';
import { createGeminiPlaywrightPage } from './gemini-playwright-page.js';
import { geminiSelectors } from './gemini-selectors.js';
import { geminiConfig } from './config/gemini.js';
import { runtimeConfig } from './config/runtime.js';
import { saveDiagnostic, saveScreenshot } from './secure-storage.js';

const providerUrls: Record<string, string> = { gemini: geminiConfig.appUrl };

const sessionSelectors = {
  blocked: geminiSelectors.blocked,
  captcha: geminiSelectors.captcha,
  composer: geminiSelectors.composer,
  login: geminiSelectors.login,
};

const observations = [
  [sessionSelectors.captcha, 'captcha'],
  [sessionSelectors.blocked, 'blocked'],
  [sessionSelectors.composer, 'usable'],
  [sessionSelectors.login, 'login-required'],
] as const;

export type PlaywrightLauncherOptions = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  chromium: Pick<typeof chromium, 'executablePath' | 'launchPersistentContext'>;
  saveDiagnostic: typeof saveDiagnostic;
  saveScreenshot: typeof saveScreenshot;
};

export function createPlaywrightBrowserLauncher(
  options: PlaywrightLauncherOptions = runtimeOptions(),
): PersistentBrowserLauncher {
  return {
    async open(request) {
      return launchBrowser(request, options);
    },
  };
}

async function launchBrowser(
  request: PersistentBrowserRequest,
  options: PlaywrightLauncherOptions,
): Promise<PersistentBrowserWindow> {
  const url = providerUrl(request.provider);
  const executablePath = discoverBrowserExecutable(
    browserCandidates(options.platform, options.env, options.chromium.executablePath()),
  );
  const context = await options.chromium.launchPersistentContext(request.profileDirectory, {
    executablePath,
    headless: !request.visible,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  return playwrightWindow(context, page, request, options);
}

function runtimeOptions(): PlaywrightLauncherOptions {
  return {
    platform: process.platform,
    env: process.env,
    chromium,
    saveDiagnostic,
    saveScreenshot,
  };
}

function playwrightWindow(
  context: BrowserContext,
  page: Page,
  request: PersistentBrowserRequest,
  options: PlaywrightLauncherOptions,
): PersistentBrowserWindow {
  return {
    observe: () => observe(page),
    wait: () => page.waitForTimeout(runtimeConfig.intervals.sessionPollMs),
    persistFailure: (error) => persistLauncherFailure(context, page, request, options, error),
    close: () => context.close(),
  };
}

async function persistLauncherFailure(
  context: BrowserContext,
  page: Page,
  request: PersistentBrowserRequest,
  options: PlaywrightLauncherOptions,
  error: Error,
): Promise<void> {
  const artifacts = {
    saveDiagnostic: async (content: string) =>
      void options.saveDiagnostic(request.provider, content),
    saveScreenshot: async (content: Uint8Array) =>
      void options.saveScreenshot(request.provider, content),
  };
  await persistGeminiFailure(createGeminiPlaywrightPage(page, context), artifacts, error);
}

async function observe(page: Page): Promise<PersistentBrowserObservation> {
  if (page.isClosed()) return 'cancelled';
  return observeOpenPage(page);
}

async function observeOpenPage(page: Page): Promise<PersistentBrowserObservation> {
  for (const [selector, observation] of observations) {
    if (await visible(page, selector)) return observation;
  }
  return page.url().startsWith(geminiConfig.accountUrlPrefix) ? 'login-required' : 'unknown';
}

async function visible(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .isVisible()
    .catch(() => false);
}

function providerUrl(provider: string): string {
  const url = providerUrls[provider];
  if (!url) throw new Error(`No browser login URL is configured for provider "${provider}".`);
  return url;
}
