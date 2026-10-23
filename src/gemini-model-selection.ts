import type { GeminiSignal } from './gemini-flow.js';
import type { GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';
import { waitForUsable, waitForUsableText, assertNotAborted } from './gemini-selection-wait.js';
import { confirmGeminiModel } from './gemini-model-confirmation.js';

type Emit = (signal: GeminiSignal) => void;

export type ModelSelection = {
  opener: GeminiUiElement;
  option(text: string): GeminiUiElement;
};

export async function openModelSelection(
  page: GeminiUiPage,
  signal?: AbortSignal,
): Promise<ModelSelection> {
  const opener = await waitForUsable(page, 'model', signal);
  if (!(await opener.expanded())) await opener.click();
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
