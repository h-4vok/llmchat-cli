import { chromium, type BrowserContext } from 'playwright';
import type { AdapterContext, AdapterHealth } from './adapter-contract.js';
import { browserCandidates, discoverBrowserExecutable } from './browser-executable.js';
import type { GeminiBrowserPort } from './gemini-adapter.js';
import { createGeminiPlaywrightPage } from './gemini-playwright-page.js';
import { persistGeminiFailure } from './gemini-failure-artifacts.js';
import { createGeminiUiConversation, type GeminiUiPage } from './gemini-ui-conversation.js';
import { saveDiagnostic, saveScreenshot } from './secure-storage.js';
import type { NativeNotificationPort } from './native-notification.js';
import { geminiConfig } from './config/gemini.js';

export type GeminiPlaywrightOptions = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  chromium: Pick<typeof chromium, 'executablePath' | 'launchPersistentContext'>;
  saveDiagnostic: typeof saveDiagnostic;
  saveScreenshot: typeof saveScreenshot;
};

export function createPlaywrightGeminiBrowser(
  notifications: NativeNotificationPort,
  options: GeminiPlaywrightOptions = runtimeOptions(),
): GeminiBrowserPort {
  return {
    async open(context) {
      const page = await openPage(context, options);
      return createGeminiUiConversation(page, artifactPort(options), notifications);
    },
    async health(context) {
      const page = await openPage(context, options);
      try {
        await page.goto(geminiConfig.appUrl);
        const health = await inspectHealth(page);
        if (health.status === 'broken') {
          await persistHealthFailure(page, options, health.message);
          return health;
        }
        await page.close();
        return health;
      } catch (failure) {
        await persistHealthFailure(page, options, errorMessage(failure));
        throw failure;
      }
    },
  };
}

async function persistHealthFailure(
  page: GeminiUiPage,
  options: GeminiPlaywrightOptions,
  message: string,
): Promise<void> {
  await persistGeminiFailure(page, artifactPort(options), new Error(message));
}

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

async function openPage(
  context: AdapterContext,
  options: GeminiPlaywrightOptions,
): Promise<GeminiUiPage> {
  const executablePath = discoverBrowserExecutable(
    browserCandidates(options.platform, options.env, options.chromium.executablePath()),
  );
  const browser = await options.chromium.launchPersistentContext(context.profileDirectory, {
    executablePath,
    headless: false,
  });
  return wrapFirstPage(browser);
}

async function wrapFirstPage(context: BrowserContext): Promise<GeminiUiPage> {
  const page = context.pages()[0] ?? (await context.newPage());
  return createGeminiPlaywrightPage(page, context);
}

async function inspectHealth(page: GeminiUiPage): Promise<AdapterHealth> {
  const composer = await page.element('composer').visible();
  const send = await page.element('send').visible();
  if (!composer)
    return { status: 'broken', message: 'Gemini UI changed: composer selector is missing.' };
  if (!send) {
    return {
      status: 'degraded',
      message: 'Gemini composer is ready; send appears after text entry and was not validated.',
    };
  }
  return { status: 'healthy', message: 'Gemini UI selectors are ready.' };
}

function artifactPort(options: GeminiPlaywrightOptions) {
  return {
    async saveDiagnostic(content: string) {
      options.saveDiagnostic('gemini', content);
    },
    async saveScreenshot(content: Uint8Array) {
      options.saveScreenshot('gemini', content);
    },
  };
}

function runtimeOptions(): GeminiPlaywrightOptions {
  return {
    platform: process.platform,
    env: process.env,
    chromium,
    saveDiagnostic,
    saveScreenshot,
  };
}
