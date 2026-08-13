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
  'blocked' | 'captcha' | 'composer' | 'error' | 'login' | 'model' | 'response' | 'send' | 'stop';

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
    async submit(request, emit) {
      await page.goto(newConversationUrl);
      await waitForIntervention(emit);
      await selectModel(page, request.model, emit);
      if (request.reasoning !== undefined)
        await selectReasoningMode(page, request.reasoning, request.model, emit);
      await (await required(page, 'composer')).fill(request.prompt);
      await (await required(page, 'send')).click();
      await monitor(page, emit, waitForIntervention);
    },
    diagnoseLocally: () => diagnose(page),
    persistFailure: (error) => persistGeminiFailure(page, artifacts, error),
    close: () => page.close(),
  };
}

async function selectModel(
  page: GeminiUiPage,
  model: string | undefined,
  emit: (signal: GeminiSignal) => void,
): Promise<void> {
  if (!model) return;
  try {
    const selected = await selectModelFromMenu(page, model, emit);
    if (!selected) await selectModelFromMenu(page, geminiFallbackModel, emit);
  } catch {
    return;
  }
}

async function monitor(
  page: GeminiUiPage,
  emit: (signal: GeminiSignal) => void,
  waitForIntervention: (emit: (signal: GeminiSignal) => void) => Promise<void>,
): Promise<void> {
  while (true) {
    await waitForIntervention(emit);
    const terminal = await terminalSignal(page);
    if (terminal) return emit(terminal);
    if (await page.element('stop').visible()) {
      emit({ kind: 'activity', message: 'Gemini is composing.' });
    }
    await page.wait();
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

async function required(page: GeminiUiPage, name: GeminiElementName): Promise<GeminiUiElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const element = page.element(name);
    if (await element.visible()) return element;
    await page.wait();
  }
  throw new Error(`Gemini UI changed: required ${name} selector is not usable.`);
}

async function diagnose(page: GeminiUiPage): Promise<{ state: string; message: string }> {
  const error = page.element('error');
  if (await error.visible()) {
    return { state: 'error', message: redactDiagnosticText(await error.innerText()) };
  }
  return { state: 'stalled', message: 'Gemini stopped producing observable UI activity.' };
}
