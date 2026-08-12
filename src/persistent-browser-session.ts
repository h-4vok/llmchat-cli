import type {
  BrowserSessionPort,
  BrowserSessionRequest,
  LoginBrowser,
  LoginBrowserRequest,
  LoginObservation,
  SessionAvailability,
} from './browser-session.js';
import { messages } from './config/messages.js';
import { runtimeConfig } from './config/runtime.js';

export type PersistentBrowserRequest = BrowserSessionRequest & { visible: boolean };
export type PersistentBrowserObservation = LoginObservation | 'unknown';

export interface PersistentBrowserWindow {
  observe(): Promise<PersistentBrowserObservation>;
  wait(): Promise<void>;
  persistFailure(error: Error): Promise<void>;
  close(): Promise<void>;
}

export interface PersistentBrowserLauncher {
  open(request: PersistentBrowserRequest): Promise<PersistentBrowserWindow>;
}

export function createPersistentBrowserSessionPort(
  launcher: PersistentBrowserLauncher,
): BrowserSessionPort {
  return {
    async checkSession(request) {
      return probeSession(launcher, { ...request, visible: request.visible ?? false });
    },
    async openLoginBrowser(request) {
      return openLogin(launcher, request);
    },
  };
}

async function probeSession(
  launcher: PersistentBrowserLauncher,
  request: BrowserSessionRequest,
): Promise<SessionAvailability> {
  const browser = await launcher.open({ ...request, visible: request.visible ?? false });
  let preserve = false;
  try {
    const result = await probeObservation(browser);
    preserve = result.preserve;
    return result.availability;
  } finally {
    if (!preserve) await browser.close();
  }
}

async function probeObservation(
  browser: PersistentBrowserWindow,
): Promise<{ availability: SessionAvailability; preserve: boolean }> {
  const observation = await observeSession(browser);
  if (observation === 'unknown') {
    await browser.persistFailure(unknownUiError());
    return { availability: 'indeterminate', preserve: true };
  }
  return { availability: observation === 'usable' ? 'usable' : 'missing', preserve: false };
}

async function observeSession(
  browser: PersistentBrowserWindow,
): Promise<PersistentBrowserObservation> {
  for (let attempt = 0; attempt < runtimeConfig.intervals.sessionDetectionAttempts; attempt += 1) {
    const observation = await browser.observe();
    if (observation !== 'unknown') return observation;
    await browser.wait();
  }
  return 'unknown';
}

async function openLogin(
  launcher: PersistentBrowserLauncher,
  request: LoginBrowserRequest,
): Promise<LoginBrowser> {
  const browser = await launcher.open(request);
  let preserve = false;
  return {
    async *observeSession() {
      while (true) {
        const observation = await browser.observe();
        if (observation === 'unknown') {
          preserve = true;
          const error = unknownUiError();
          await browser.persistFailure(error);
          yield 'indeterminate';
          return;
        }
        yield observation;
        if (isTerminal(observation, request.visible)) return;
        await browser.wait();
      }
    },
    async close() {
      if (!preserve) await browser.close();
    },
  };
}

function unknownUiError(): Error {
  return new Error(messages.unknownSession);
}

function isTerminal(observation: LoginObservation, visible: boolean): boolean {
  return visible ? observation === 'cancelled' : ['usable', 'cancelled'].includes(observation);
}
