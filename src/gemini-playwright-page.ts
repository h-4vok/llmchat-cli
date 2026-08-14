import type { BrowserContext, Locator, Page } from 'playwright';
import { geminiSelectors } from './gemini-selectors.js';
import type { GeminiUiElement, GeminiUiPage } from './gemini-ui-conversation.js';

export function createGeminiPlaywrightPage(page: Page, context: BrowserContext): GeminiUiPage {
  return {
    goto: async (url) => void (await page.goto(url)),
    element: (name) => playwrightElement(page.locator(geminiSelectors[name]).first()),
    exactText: (text) =>
      playwrightElement(page.locator('gem-menu-item').filter({ hasText: text }).first()),
    wait: () => page.waitForTimeout(500),
    closed: () => page.isClosed(),
    currentUrl: () => page.url(),
    screenshot: async () => page.screenshot({ fullPage: false, type: 'png' }),
    close: () => context.close(),
    waitForClose: () => waitForPageClose(page),
  };
}

async function waitForPageClose(page: Page): Promise<void> {
  while (!page.isClosed()) {
    try {
      await page.waitForTimeout(500);
    } catch (error) {
      if (page.isClosed()) return;
      throw error;
    }
  }
}

function playwrightElement(locator: Locator): GeminiUiElement {
  return {
    visible: () => locator.isVisible().catch(() => false),
    enabled: () => locator.isEnabled().catch(() => false),
    click: () => locator.click(),
    fill: (value) => locator.fill(value),
    innerText: () => locator.innerText(),
    active: () =>
      locator
        .evaluate(
          (element) =>
            element.classList.contains('selected') || Boolean(element.querySelector('.selected')),
        )
        .catch(() => false),
  };
}
