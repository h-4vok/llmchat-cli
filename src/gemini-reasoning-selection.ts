import { requestedReasoning, resolveGeminiReasoning } from './config/reasoning.js';
import type { GeminiSignal } from './gemini-flow.js';
import type { GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';
import { assertNotAborted, usable, waitForUsableText } from './gemini-selection-wait.js';
import { openModelSelection, type ModelSelection } from './gemini-model-selection.js';

type Emit = (signal: GeminiSignal) => void;
type ReasoningArguments = [
  GeminiUiPage,
  string | undefined,
  string | undefined,
  Emit,
  AbortSignal?,
];

export async function selectReasoningMode(
  ...[page, requested, model, emit, signal]: ReasoningArguments
): Promise<void> {
  const reasoning = requestedReasoning(resolveGeminiReasoning(model), requested);
  if (!reasoning) return warnUnsupported(requested, emit);
  const selection = await availableSelection(page, emit, signal);
  if (!selection) return;
  const choice = await availableReasoningChoice({
    page,
    selection,
    level: reasoning.uiValue,
    emit,
    signal,
  });
  if (choice) await applyReasoningChoice({ page, choice, level: reasoning.uiValue, emit, signal });
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

async function availableReasoningChoice({
  page,
  selection,
  level,
  emit,
  signal,
}: ReasoningSelection): Promise<GeminiUiElement | undefined> {
  try {
    const opener = await waitForUsableText(page, selection.option, 'Thinking level', signal);
    await opener.click();
    return await waitForUsableText(page, selection.option, level, signal);
  } catch {
    assertNotAborted(signal);
    warnReasoning(emit, 'reasoning option is unavailable');
  }
}

async function applyReasoningChoice({
  page,
  choice,
  level,
  emit,
  signal,
}: Omit<ReasoningSelection, 'selection'> & { choice: GeminiUiElement }): Promise<void> {
  if (!(await usable(choice))) return warnReasoning(emit, 'reasoning option is unavailable');
  if (!(await choice.active())) await clickReasoning(choice, emit);
  await page.wait();
  await verifyReasoning(page, level, emit, signal);
}

async function clickReasoning(choice: GeminiUiElement, emit: Emit): Promise<void> {
  try {
    await choice.click();
  } catch {
    warnReasoning(emit, 'level could not be selected');
  }
}

async function verifyReasoning(
  page: GeminiUiPage,
  level: string,
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> {
  let stage = 'reopening the model menu';
  try {
    const selection = await openModelSelection(page, signal);
    stage = 'waiting for "Thinking level" in the reopened model menu';
    const opener = await waitForUsableText(page, selection.option, 'Thinking level', signal);
    stage = 'opening the "Thinking level" submenu';
    await opener.click();
    stage = `waiting for reasoning level "${level}" in the submenu`;
    const selected = await waitForUsableText(page, selection.option, level, signal);
    stage = `checking whether reasoning level "${level}" is selected`;
    const active = await selected.active();
    stage = 'closing the model menu after verification';
    await selection.opener.click();
    if (!active)
      warnReasoning(emit, `verification found reasoning level "${level}" was not selected`);
  } catch {
    assertNotAborted(signal);
    warnReasoning(emit, `verification failed while ${stage}`);
  }
}

function warnUnsupported(value: string | undefined, emit: Emit): void {
  if (value !== undefined)
    emit({ kind: 'activity', message: `Warning: Gemini does not support reasoning "${value}".` });
}

function warnReasoning(emit: Emit, reason: string): void {
  emit({ kind: 'activity', message: `Warning: Gemini reasoning ${reason}; continuing.` });
}

type ReasoningSelection = {
  page: GeminiUiPage;
  selection: ModelSelection;
  level: string;
  emit: Emit;
  signal?: AbortSignal;
};
