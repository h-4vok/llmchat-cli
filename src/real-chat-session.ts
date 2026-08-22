import type { AdapterContext, AdapterDiagnostic } from './adapter-contract.js';
import {
  ensureBrowserSession,
  type BrowserSessionObserver,
  type BrowserSessionPorts,
  type BrowserSessionRequest,
  type BrowserSessionResult,
} from './browser-session.js';
import { diagnosticForBrowserSession } from './browser-session-diagnostic.js';
import { capabilitiesForProvider } from './chat-runtime.js';
import type { ProfileLeaseRegistry } from './profile-lease-registry.js';

type SessionOptions = { visible?: boolean; interactive?: boolean };
type RealChatSessionRequest = {
  provider: string;
  context: AdapterContext;
  options: SessionOptions;
  ports: BrowserSessionPorts;
  profiles: ProfileLeaseRegistry;
  diagnostics: WeakMap<AdapterContext, AdapterDiagnostic>;
};

export function ensureRealChatSession({
  provider,
  context,
  options,
  ports,
  profiles,
  diagnostics,
}: RealChatSessionRequest): Promise<BrowserSessionResult> {
  if (!capabilitiesForProvider(provider).browserSession)
    return Promise.resolve({ status: 'ready', source: 'reused' });
  const request = sessionRequest(provider, profiles.acquire(context).profileDirectory, options);
  const observer = diagnosticObserver(provider, context, diagnostics);
  if (options.interactive === false) return checkBrowserSession(request, ports, observer);
  return ensureBrowserSession(request, ports, observer);
}

async function checkBrowserSession(
  request: BrowserSessionRequest,
  ports: BrowserSessionPorts,
  observer: BrowserSessionObserver,
): Promise<BrowserSessionResult> {
  observer({ status: 'checking' });
  const availability = await ports.browser.checkSession(request);
  if (availability === 'usable') return { status: 'ready', source: 'reused' };
  if (availability === 'indeterminate') return { status: 'indeterminate' };
  observer({ status: 'attention-required', reason: 'login' });
  return { status: 'authentication-required' };
}

function sessionRequest(
  provider: string,
  profileDirectory: string,
  options: SessionOptions,
): BrowserSessionRequest {
  const visible = options.interactive === false ? false : options.visible;
  return { provider, profileDirectory, visible };
}

function diagnosticObserver(
  provider: string,
  context: AdapterContext,
  diagnostics: WeakMap<AdapterContext, AdapterDiagnostic>,
): BrowserSessionObserver {
  return (state) => diagnostics.set(context, diagnosticForBrowserSession(state, provider));
}
