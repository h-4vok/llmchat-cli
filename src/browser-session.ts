import { authenticationAttention, type NativeNotificationPort } from './native-notification.js';
import { messages } from './config/messages.js';

export type SessionAvailability = 'usable' | 'missing' | 'expired' | 'indeterminate';
export type LoginObservation =
  'login-required' | 'captcha' | 'blocked' | 'usable' | 'cancelled' | 'indeterminate';

export type BrowserSessionRequest = {
  provider: string;
  profileDirectory: string;
};

export type LoginBrowserRequest = BrowserSessionRequest & {
  visible: true;
};

export interface LoginBrowser {
  observeSession(): AsyncIterable<LoginObservation>;
  close(): Promise<void>;
}

export interface BrowserSessionPort {
  checkSession(request: BrowserSessionRequest): Promise<SessionAvailability>;
  openLoginBrowser(request: LoginBrowserRequest): Promise<LoginBrowser>;
}

export type BrowserSessionPorts = {
  browser: BrowserSessionPort;
  notifications: NativeNotificationPort;
};

export type BrowserSessionState =
  | { status: 'checking' }
  | { status: 'attention-required'; reason: 'login' | 'captcha' | 'blocked' }
  | { status: 'indeterminate' }
  | { status: 'ready'; source: 'reused' | 'authenticated' }
  | { status: 'cancelled' };

export type BrowserSessionEvent =
  | { type: 'session-reused' }
  | { type: 'session-required' }
  | { type: 'login-observed'; observation: LoginObservation };

export type BrowserSessionResult =
  | { status: 'ready'; source: 'reused' | 'authenticated' }
  | { status: 'cancelled' }
  | { status: 'indeterminate' };

export type BrowserSessionObserver = (state: BrowserSessionState) => void;

const sessionStates = {
  'session-reused': { status: 'ready', source: 'reused' },
  'session-required': { status: 'attention-required', reason: 'login' },
} as const;

const loginStates = {
  'login-required': { status: 'attention-required', reason: 'login' },
  captcha: { status: 'attention-required', reason: 'captcha' },
  blocked: { status: 'attention-required', reason: 'blocked' },
  indeterminate: { status: 'indeterminate' },
  usable: { status: 'ready', source: 'authenticated' },
  cancelled: { status: 'cancelled' },
} as const;

export function transitionBrowserSession(
  _state: BrowserSessionState,
  event: BrowserSessionEvent,
): BrowserSessionState {
  if (event.type === 'login-observed') return loginStates[event.observation];
  return sessionStates[event.type];
}

export async function ensureBrowserSession(
  request: BrowserSessionRequest,
  ports: BrowserSessionPorts,
  observer?: BrowserSessionObserver,
): Promise<BrowserSessionResult> {
  const checking: BrowserSessionState = { status: 'checking' };
  report(observer, checking);
  const availability = await ports.browser.checkSession(request);
  if (availability === 'usable') {
    const reused: BrowserSessionResult = { status: 'ready', source: 'reused' };
    return report(observer, reused);
  }
  const required = transitionBrowserSession(checking, { type: 'session-required' });
  report(observer, required);
  const login = await ports.browser.openLoginBrowser({ ...request, visible: true });
  try {
    await ports.notifications.send(authenticationAttention(request.provider));
    return await waitForLogin(login, required, observer);
  } finally {
    await login.close();
  }
}

async function waitForLogin(
  login: LoginBrowser,
  initialState: BrowserSessionState,
  observer?: BrowserSessionObserver,
): Promise<BrowserSessionResult> {
  let state = initialState;
  for await (const observation of login.observeSession()) {
    state = transitionBrowserSession(state, { type: 'login-observed', observation });
    report(observer, state);
    const result = terminalResult(state);
    if (result) return result;
  }
  throw new Error(messages.loginStopped);
}

function terminalResult(state: BrowserSessionState): BrowserSessionResult | undefined {
  if (state.status === 'ready' || state.status === 'cancelled' || state.status === 'indeterminate')
    return state;
  return undefined;
}

function report<State extends BrowserSessionState>(
  observer: BrowserSessionObserver | undefined,
  state: State,
): State {
  observer?.(state);
  return state;
}
