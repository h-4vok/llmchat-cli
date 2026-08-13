import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiPlaywrightPage } from '../dist/gemini-playwright-page.js';

function locator(calls, name, rejectVisibility = false) {
  return {
    first() {
      calls.push(['first', name]);
      return this;
    },
    filter(options) {
      calls.push(['filter', name, options]);
      return this;
    },
    async isVisible() {
      calls.push(['visible', name]);
      if (rejectVisibility) throw new Error('detached');
      return true;
    },
    async isEnabled() {
      calls.push(['enabled', name]);
      return true;
    },
    async click() {
      calls.push(['click', name]);
    },
    async fill(value) {
      calls.push(['fill', name, value]);
    },
    async innerText() {
      calls.push(['innerText', name]);
      return 'plain text';
    },
    async evaluate(callback) {
      calls.push(['evaluate', name]);
      if (name === 'selected')
        return callback({ classList: { contains: () => true }, querySelector: () => null });
      if (name === 'selected-query')
        return callback({ classList: { contains: () => false }, querySelector: () => ({}) });
      throw new Error('detached');
    },
  };
}

test('Playwright page boundary centralizes selectors and viewport operations', async () => {
  const calls = [];
  const page = {
    async goto(url) {
      calls.push(['goto', url]);
    },
    locator(selector) {
      calls.push(['locator', selector]);
      return locator(calls, selector);
    },
    async waitForTimeout(ms) {
      calls.push(['wait', ms]);
    },
    isClosed: () => false,
    url: () => 'https://gemini.google.com/app',
    async screenshot(options) {
      calls.push(['screenshot', options]);
      return new Uint8Array([7]);
    },
  };
  const context = {
    async close() {
      calls.push(['close']);
    },
  };
  const boundary = createGeminiPlaywrightPage(page, context);

  await boundary.goto('https://gemini.google.com/app');
  const composer = boundary.element('composer');
  assert.equal(await composer.visible(), true);
  await composer.click();
  await composer.fill('hello');
  assert.equal(await composer.innerText(), 'plain text');
  assert.equal(await boundary.exactText('Gemini Pro').visible(), true);
  await boundary.wait();
  assert.equal(boundary.closed(), false);
  assert.equal(boundary.currentUrl(), 'https://gemini.google.com/app');
  assert.deepEqual(await boundary.screenshot(), new Uint8Array([7]));
  await boundary.close();
  assert.ok(calls.some((call) => call[0] === 'locator' && call[1] === 'gem-menu-item'));
  assert.ok(calls.some((call) => call[0] === 'screenshot' && call[1].fullPage === false));
  const selectors = calls.filter(([kind]) => kind === 'locator').map(([, selector]) => selector);
  assert.ok(
    selectors.some((selector) =>
      selector.includes('div[role="textbox"][aria-label="Enter a prompt for Gemini"]'),
    ),
  );

  boundary.element('model');
  const modelSelector = calls.filter(([kind]) => kind === 'locator').at(-1)[1];
  assert.match(modelSelector, /Open mode picker/);
  assert.match(modelSelector, /aria-label\*="model"/i);
});

test('detached Playwright locators are treated as not visible', async () => {
  const page = {
    locator: () => locator([], 'detached', true),
  };
  const boundary = createGeminiPlaywrightPage(page, {});
  assert.equal(await boundary.element('error').visible(), false);
});

test('selected Playwright menu items expose active state', async () => {
  const page = { locator: () => locator([], 'selected') };
  const boundary = createGeminiPlaywrightPage(page, {});
  assert.equal(await boundary.exactText('Extended thinking').active(), true);
});

test('nested selected Playwright menu icons expose active state', async () => {
  const page = { locator: () => locator([], 'selected-query') };
  const boundary = createGeminiPlaywrightPage(page, {});
  assert.equal(await boundary.exactText('Extended thinking').active(), true);
});

test('detached Playwright active state is treated as inactive', async () => {
  const page = { locator: () => locator([], 'rejected') };
  const boundary = createGeminiPlaywrightPage(page, {});
  assert.equal(await boundary.exactText('Extended thinking').active(), false);
});
