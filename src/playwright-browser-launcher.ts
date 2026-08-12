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
  login: geminiSelectors.login,
  loginText: geminiSelectors.loginText,
  authenticated: geminiSelectors.authenticated,
};

const observations = [
  [sessionSelectors.captcha, 'captcha'],
  [sessionSelectors.blocked, 'blocked'],
  [sessionSelectors.login, 'login-required'],
  [sessionSelectors.loginText, 'login-required'],
  [sessionSelectors.authenticated, 'usable'],
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
    timeout: runtimeConfig.timeouts.browserLaunchMs,
    ignoreDefaultArgs: ['--no-sandbox'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await preparePage(context);
  await page.goto(url);
  return playwrightWindow(context, page, request, options);
}

async function preparePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await Promise.all(pages.slice(1).map((extra) => extra.close().catch(() => undefined)));
  return page;
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
    wait: () =>
      page
        .waitForTimeout(runtimeConfig.intervals.sessionPollMs)
        .catch((error) =>
          page.isClosed() || String(error).includes('closed') ? undefined : Promise.reject(error),
        ),
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
  return fallbackObservation(page);
}

function fallbackObservation(page: Page): PersistentBrowserObservation {
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
