import type { GeminiElementName, GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';

export async function waitForUsable(
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

export async function waitForUsableText(
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

export function assertNotAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

export async function usable(element: GeminiUiElement): Promise<boolean> {
  return (await element.visible()) && (await element.enabled());
}
