import type { GeminiUiElement } from './gemini-ui-conversation.js';
import { isSelectedGeminiModel } from './gemini-model-name.js';

export async function confirmGeminiModel(
  opener: GeminiUiElement,
  choice: GeminiUiElement,
  requested: string,
  buttonText: string,
): Promise<void> {
  if (isSelectedGeminiModel(requested, buttonText)) return;
  await opener.click();
  const selected = await choice.active();
  await opener.click();
  if (!selected)
    throw new Error(
      `Gemini model "${requested}" was not confirmed as selected; selector shows "${buttonText}".`,
    );
}
