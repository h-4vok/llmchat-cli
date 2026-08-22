import type { GeminiSignal } from './gemini-flow.js';
import { requestedReasoning, resolveGeminiReasoning } from './config/reasoning.js';
import type { GeminiElementName, GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';

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
): Promise<boolean> {
  const selection = await openModelSelection(page, signal);
  emit({ kind: 'activity', message: `Gemini model selection command: ${model}` });
  const choice = selection.option(model);
  if (!(await usable(choice))) return false;
  await choice.click();
  emit({
    kind: 'activity',
    message: `Gemini model selector text: ${await selection.opener.innerText()}`,
  });
  return true;
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

async function waitForUsable(
  page: GeminiUiPage,
  name: GeminiElementName,
  signal?: AbortSignal,
): Promise<GeminiUiElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assertNotAborted(signal);
    const element = page.element(name);
    if (await usable(element)) return element;
    await page.wait();
    assertNotAborted(signal);
  }
  throw new Error(`Gemini UI changed: ${name} selector did not become usable.`);
}

async function waitForUsableText(
  page: GeminiUiPage,
  option: (text: string) => GeminiUiElement,
  text: string,
  signal?: AbortSignal,
): Promise<GeminiUiElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assertNotAborted(signal);
    const element = option(text);
    if (await usable(element)) return element;
    await page.wait();
    assertNotAborted(signal);
  }
  throw new Error(`Gemini UI changed: ${text} option did not become usable.`);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

async function usable(element: GeminiUiElement): Promise<boolean> {
  return (await element.visible()) && (await element.enabled());
}

function warnUnsupported(value: string | undefined, emit: Emit): void {
  if (value !== undefined)
    emit({ kind: 'activity', message: `Warning: Gemini does not support reasoning "${value}".` });
}

function warnReasoning(emit: Emit, reason: string): void {
  emit({ kind: 'activity', message: `Warning: Gemini reasoning ${reason}; continuing.` });
}
