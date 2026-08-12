import type { AdapterDiagnostic } from './adapter-contract.js';
import type { BrowserSessionState } from './browser-session.js';

export function diagnosticForBrowserSession(
  state: BrowserSessionState,
  provider: string,
): AdapterDiagnostic {
  const name = providerName(provider);
  if (state.status === 'attention-required') return attentionDiagnostic(name, state.reason);
  if (state.status === 'cancelled')
    return { state: 'error', message: `${name} sign-in was cancelled.` };
  return { state: 'progress', message: `${name} session ${state.status}.` };
}

function attentionDiagnostic(
  provider: string,
  reason: 'login' | 'captcha' | 'blocked',
): AdapterDiagnostic {
  if (reason === 'login') {
    return { state: 'session-required', message: `Manual ${provider} sign-in is required.` };
  }
  return { state: 'blocked', message: `${provider} requires manual intervention (${reason}).` };
}

function providerName(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
