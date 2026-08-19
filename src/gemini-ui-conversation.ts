import type { GeminiConversation } from './gemini-adapter.js';
import {
  persistGeminiFailure,
  type GeminiArtifactPage,
  type GeminiArtifactPort,
} from './gemini-failure-artifacts.js';
import type { GeminiSignal } from './gemini-flow.js';
import { createGeminiInterventionWaiter } from './gemini-intervention.js';
import type { NativeNotificationPort } from './native-notification.js';
import { redactDiagnosticText } from './secret-redaction.js';
import { geminiConfig } from './config/gemini.js';
import {
  selectModel as selectModelFromMenu,
  selectReasoningMode,
} from './gemini-model-selection.js';

export type GeminiElementName =
  | 'blocked'
  | 'captcha'
  | 'composer'
  | 'error'
  | 'login'
  | 'model'
  | 'response'
  | 'send'
  | 'stop'
  | 'temporaryChat';

export interface GeminiUiElement {
  visible(): Promise<boolean>;
  enabled(): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  innerText(): Promise<string>;
  active(): Promise<boolean>;
}

export interface GeminiUiPage extends GeminiArtifactPage {
  goto(url: string): Promise<void>;
  element(name: GeminiElementName): GeminiUiElement;
  exactText(text: string): GeminiUiElement;
  wait(): Promise<void>;
  closed(): boolean;
  close(): Promise<void>;
  waitForClose(): Promise<void>;
}

export type { GeminiArtifactPort } from './gemini-failure-artifacts.js';
const newConversationUrl = geminiConfig.appUrl;
const geminiFallbackModel = '3.5 Flash-Lite';

export function createGeminiUiConversation(
  page: GeminiUiPage,
  artifacts: GeminiArtifactPort,
  notifications: NativeNotificationPort,
): GeminiConversation {
  const waitForIntervention = createGeminiInterventionWaiter(page, notifications);
  return {
    async submit(request, emit, signal) {
      await page.goto(newConversationUrl);
      throwIfAborted(signal);
      await waitForIntervention(emit, signal);
      if (request.disposableConversation) await enableTemporaryChat(page, signal);
      await selectModel(page, request.model, emit, signal);
      if (request.reasoning !== undefined)
        await selectReasoningMode(page, request.reasoning, request.model, emit, signal);
      await (await required(page, 'composer', signal)).fill(request.prompt);
      throwIfAborted(signal);
      await (await required(page, 'send', signal)).click();
      await monitor(page, emit, waitForIntervention, signal);
    },
    diagnoseLocally: () => diagnose(page),
    persistFailure: (error) => persistGeminiFailure(page, artifacts, error),
    close: () => page.close(),
    waitForClose: () => page.waitForClose(),
  };
}
async function enableTemporaryChat(page: GeminiUiPage, signal?: AbortSignal): Promise<void> {
  await (await required(page, 'temporaryChat', signal)).click();
}
async function selectModel(
  page: GeminiUiPage,
  model: string | undefined,
  emit: (signal: GeminiSignal) => void,
  cancellation?: AbortSignal,
): Promise<void> {
  if (!model) return;
  try {
    const selected = await selectModelFromMenu(page, model, emit, cancellation);
    if (!selected) await selectModelFromMenu(page, geminiFallbackModel, emit, cancellation);
  } catch {
    throwIfAborted(cancellation);
    return;
  }
}
async function monitor(
  page: GeminiUiPage,
  emit: (signal: GeminiSignal) => void,
  waitForIntervention: (
    emit: (signal: GeminiSignal) => void,
    signal?: AbortSignal,
  ) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  while (true) {
    throwIfAborted(signal);
    await waitForIntervention(emit, signal);
    const terminal = await terminalSignal(page);
    if (terminal) return emit(terminal);
    if (await page.element('stop').visible()) {
      emit({ kind: 'activity', message: 'Gemini is composing.' });
    }
    await page.wait();
    throwIfAborted(signal);
  }
}

async function terminalSignal(page: GeminiUiPage): Promise<GeminiSignal | undefined> {
  const error = page.element('error');
  if (await error.visible()) return { kind: 'error', message: await error.innerText() };
  const response = page.element('response');
  const completed = (await response.visible()) && !(await page.element('stop').visible());
  if (completed) return { kind: 'response', text: await response.innerText() };
  return undefined;
}

async function required(
  page: GeminiUiPage,
  name: GeminiElementName,
  signal?: AbortSignal,
): Promise<GeminiUiElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    throwIfAborted(signal);
    const element = page.element(name);
    if (await element.visible()) return element;
    await page.wait();
  }
  throw new Error(`Gemini UI changed: required ${name} selector is not usable.`);
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
async function diagnose(page: GeminiUiPage): Promise<{ state: string; message: string }> {
  const error = page.element('error');
  if (await error.visible()) {
    return { state: 'error', message: redactDiagnosticText(await error.innerText()) };
  }
  return { state: 'stalled', message: 'Gemini stopped producing observable UI activity.' };
}
