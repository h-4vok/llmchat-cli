import type {
  BrowserSessionPort,
  BrowserSessionRequest,
  LoginBrowser,
  LoginBrowserRequest,
  LoginObservation,
  SessionAvailability,
} from './browser-session.js';
import { messages } from './config/messages.js';

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
      return probeSession(launcher, request);
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
  const browser = await launcher.open({ ...request, visible: false });
  let preserve = false;
  try {
    const observation = await browser.observe();
    if (observation !== 'unknown') return observation === 'usable' ? 'usable' : 'missing';
    preserve = true;
    const error = unknownUiError();
    await browser.persistFailure(error);
    return 'indeterminate';
  } finally {
    if (!preserve) await browser.close();
  }
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
        if (isTerminal(observation)) return;
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

function isTerminal(observation: LoginObservation): boolean {
  return ['usable', 'cancelled'].includes(observation);
}
