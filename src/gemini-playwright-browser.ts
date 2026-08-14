import { chromium, type BrowserContext } from 'playwright';
import type { AdapterContext, AdapterHealth } from './adapter-contract.js';
import { browserCandidates, discoverBrowserExecutable } from './browser-executable.js';
import type { GeminiBrowserPort } from './gemini-adapter.js';
import { createGeminiPlaywrightPage } from './gemini-playwright-page.js';
import { persistGeminiFailure } from './gemini-failure-artifacts.js';
import { createGeminiUiConversation, type GeminiUiPage } from './gemini-ui-conversation.js';
import { geminiArtifactPort } from './gemini-artifact-port.js';
import { saveDiagnostic, saveScreenshot } from './secure-storage.js';
import type { NativeNotificationPort } from './native-notification.js';
import { geminiConfig } from './config/gemini.js';
import { runtimeConfig } from './config/runtime.js';

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
      return createGeminiUiConversation(page, geminiArtifactPort(options), notifications);
    },
    async health(context) {
      const page = await openPage(context, options);
      try {
        await page.goto(geminiConfig.appUrl);
        const health = await inspectHealth(page);
        if (health.status === 'broken') await persistHealthFailure(page, options, health.message);
        await tryClose(page);
        return health;
      } catch (failure) {
        await tryPersistHealthFailure(page, options, errorMessage(failure));
        await tryClose(page);
        throw failure;
      }
    },
  };
}

async function tryPersistHealthFailure(
  page: GeminiUiPage,
  options: GeminiPlaywrightOptions,
  message: string,
): Promise<void> {
  try {
    await persistHealthFailure(page, options, message);
  } catch {
    return;
  }
}

async function tryClose(page: GeminiUiPage): Promise<void> {
  try {
    await page.close();
  } catch {
    return;
  }
}

async function persistHealthFailure(
  page: GeminiUiPage,
  options: GeminiPlaywrightOptions,
  message: string,
): Promise<void> {
  await persistGeminiFailure(page, geminiArtifactPort(options), new Error(message));
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
    timeout: 15_000,
    ignoreDefaultArgs: ['--no-sandbox'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return wrapFirstPage(browser);
}

async function wrapFirstPage(context: BrowserContext): Promise<GeminiUiPage> {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await Promise.all(pages.slice(1).map((extra) => extra.close().catch(() => undefined)));
  return createGeminiPlaywrightPage(page, context);
}

async function inspectHealth(page: GeminiUiPage): Promise<AdapterHealth> {
  if (!(await waitForVisible(page, 'composer')))
    return { status: 'broken', message: 'Gemini UI changed: composer selector is missing.' };
  if (!(await waitForVisible(page, 'model')))
    return { status: 'broken', message: 'Gemini UI changed: model selector is missing.' };
  await page.element('composer').fill('health check');
  if (!(await waitForVisible(page, 'send')))
    return {
      status: 'broken',
      message: 'Gemini UI changed: send button is missing after text entry.',
    };
  return {
    status: 'healthy',
    message:
      'Gemini page found. Composer found. Model selector found. Send button found after text entry.',
  };
}

async function waitForVisible(
  page: GeminiUiPage,
  element: Parameters<GeminiUiPage['element']>[0],
): Promise<boolean> {
  const deadline = Date.now() + healthElementTimeout();
  while (Date.now() <= deadline) {
    if (page.closed()) return false;
    if (await page.element(element).visible()) return true;
    await page.wait();
  }
  return false;
}

function healthElementTimeout(): number {
  return runtimeConfig.timeouts.healthElementMs;
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
