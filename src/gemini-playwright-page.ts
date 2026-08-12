import type { BrowserContext, Locator, Page } from 'playwright';
import { geminiSelectors } from './gemini-selectors.js';
import type { GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';

export function createGeminiPlaywrightPage(page: Page, context: BrowserContext): GeminiUiPage {
  return {
    goto: async (url) => void (await page.goto(url)),
    element: (name) => playwrightElement(page.locator(geminiSelectors[name]).first()),
    exactText: (text) => playwrightElement(page.getByText(text, { exact: true }).first()),
    wait: () => page.waitForTimeout(500),
    closed: () => page.isClosed(),
    currentUrl: () => page.url(),
    screenshot: async () => page.screenshot({ fullPage: false, type: 'png' }),
    close: () => context.close(),
  };
}

function playwrightElement(locator: Locator): GeminiUiElement {
  return {
    visible: () => locator.isVisible().catch(() => false),
    click: () => locator.click(),
    fill: (value) => locator.fill(value),
    innerText: () => locator.innerText(),
  };
}
