import type { GeminiSignal } from './gemini-flow.js';
import { requestedReasoning, resolveGeminiReasoning } from './config/reasoning.js';
import type { GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';
import {
  waitForUsable,
  waitForUsableText,
  usable,
  assertNotAborted,
} from './gemini-selection-wait.js';
import { confirmGeminiModel } from './gemini-model-confirmation.js';

type Emit = (signal: GeminiSignal) => void;
type ReasoningSelectionArguments = [
  GeminiUiPage,
  string | undefined,
  string | undefined,
  Emit,
  AbortSignal?,
];

export type ModelSelection = {
  opener: GeminiUiElement;
  option(text: string): GeminiUiElement;
};

export async function openModelSelection(
  page: GeminiUiPage,
  signal?: AbortSignal,
): Promise<ModelSelection> {
  const opener = await waitForUsable(page, 'model', signal);
  await opener.click();
  return { opener, option: (text) => page.exactText(text) };
}

export async function selectModel(
  page: GeminiUiPage,
  model: string,
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> {
  const selection = await openModelSelection(page, signal);
  emit({ kind: 'activity', message: `Gemini model selection command: ${model}` });
  const choice = await requestedModelChoice(page, model, signal);
  const choiceText = await choice.innerText();
  await choice.click();
  const selected = await selection.opener.innerText();
  emit({ kind: 'activity', message: `Gemini model selector text: ${selected}` });
  await confirmGeminiModel(selection.opener, choice, model, selected);
  emit({ kind: 'activity', message: `Gemini selected model menu option: ${choiceText.trim()}` });
}

async function requestedModelChoice(
  page: GeminiUiPage,
  model: string,
  signal?: AbortSignal,
): Promise<GeminiUiElement> {
  try {
    return await waitForUsableText(page, (text) => page.modelOption(text), model, signal);
  } catch (error) {
    assertNotAborted(signal);
    throw new Error(`Gemini model "${model}" is unavailable or ambiguous; no prompt was sent.`, {
      cause: error,
    });
  }
}

export async function selectReasoningMode(
  ...[page, requested, model, emit, signal]: ReasoningSelectionArguments
): Promise<void> {
  const reasoning = requestedReasoning(resolveGeminiReasoning(model), requested);
  if (!reasoning) return warnUnsupported(requested, emit);
  const selection = await availableSelection(page, emit, signal);
  if (!selection) return;
  const choice = await availableReasoningChoice(page, selection, emit, signal);
  if (!choice) return;
  await applyReasoningChoice(choice, selection.opener, reasoning.extended, emit);
}

async function availableSelection(
  page: GeminiUiPage,
  emit: Emit,
  signal?: AbortSignal,
): Promise<ModelSelection | undefined> {
  try {
    return await openModelSelection(page, signal);
  } catch {
    assertNotAborted(signal);
    warnReasoning(emit, 'model selector is unavailable');
  }
}

async function availableReasoningChoice(
  page: GeminiUiPage,
  selection: ModelSelection,
  emit: Emit,
  signal?: AbortSignal,
): Promise<GeminiUiElement | undefined> {
  try {
    return await waitForUsableText(page, selection.option, 'Extended thinking', signal);
  } catch {
    assertNotAborted(signal);
    warnReasoning(emit, 'reasoning option is unavailable');
  }
}

async function applyReasoningChoice(
  choice: GeminiUiElement,
  opener: GeminiUiElement,
  desired: boolean,
  emit: Emit,
): Promise<void> {
  if (await usable(choice)) {
    if ((await choice.active()) !== desired) await clickReasoning(choice, emit);
    await verifyReasoning(opener, desired, emit);
    return;
  }
  warnReasoning(emit, 'reasoning option is unavailable');
}

async function clickReasoning(choice: GeminiUiElement, emit: Emit): Promise<void> {
  try {
    await choice.click();
  } catch {
    warnReasoning(emit, 'toggle could not be changed');
  }
}

async function verifyReasoning(
  opener: GeminiUiElement,
  desired: boolean,
  emit: Emit,
): Promise<void> {
  if ((await opener.innerText()).includes('Extended') !== desired)
    warnReasoning(emit, 'reasoning state could not be verified');
}

function warnUnsupported(value: string | undefined, emit: Emit): void {
  if (value !== undefined)
    emit({ kind: 'activity', message: `Warning: Gemini does not support reasoning "${value}".` });
}

function warnReasoning(emit: Emit, reason: string): void {
  emit({ kind: 'activity', message: `Warning: Gemini reasoning ${reason}; continuing.` });
}
