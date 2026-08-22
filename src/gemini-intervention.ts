import type { GeminiSignal } from './gemini-flow.js';
import type { GeminiUiPage } from './gemini-ui-conversation.js';
import { authenticationAttention, type NativeNotificationPort } from './native-notification.js';
import { geminiConfig } from './config/gemini.js';

type Intervention = 'blocked' | 'captcha' | 'login' | 'cancelled';
type Emit = (signal: GeminiSignal) => void;

const candidates = ['captcha', 'blocked', 'login'] as const;

export function createGeminiInterventionWaiter(
  page: GeminiUiPage,
  notifications: NativeNotificationPort,
) {
  let notified = false;
  async function notifyOnce(): Promise<void> {
    if (notified) return;
    notified = true;
    await notifications.send(authenticationAttention('gemini'));
  }
  return async (emit: Emit, signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted();
    const intervention = await observeIntervention(page);
    if (!intervention) return;
    if (intervention === 'cancelled') throw cancellationError();
    await notifyOnce();
    await waitUntilResolved(page, intervention, emit, signal);
  };
}

async function waitUntilResolved(
  page: GeminiUiPage,
  initial: Intervention,
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> {
  let intervention: Intervention | undefined = initial;
  while (intervention) {
    assertNotAborted(signal);
    if (intervention === 'cancelled') throw cancellationError();
    emit({ kind: 'activity', message: `Gemini awaits manual ${intervention} resolution.` });
    await page.wait();
    assertNotAborted(signal);
    intervention = await observeIntervention(page);
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function cancellationError(): Error {
  return new Error('Manual Gemini intervention was cancelled.');
}

async function observeIntervention(page: GeminiUiPage): Promise<Intervention | undefined> {
  if (page.closed()) return 'cancelled';
  const visible = await visibleIntervention(page);
  return visible ?? urlIntervention(page.currentUrl());
}

async function visibleIntervention(page: GeminiUiPage): Promise<Intervention | undefined> {
  for (const candidate of candidates) {
    if (await page.element(candidate).visible()) return candidate;
  }
  return undefined;
}

function urlIntervention(url: string): Intervention | undefined {
  return url.startsWith(geminiConfig.accountUrlPrefix) ? 'login' : undefined;
}
