import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';
import { createGeminiAdapter } from '../dist/gemini-adapter.js';
import {
  playwrightGeminiBrowserFixture,
  geminiAdapterContext as context,
} from '../test-support/gemini-playwright-browser-fixture.mjs';

for (const command of ['chat', 'health', 'auth']) {
  test(`CLI ${command} honors --headless without interactive login`, async () => {
    const seen = {};
    const runtime = {
      contextFor: () => context,
      adapterFor: () => ({
        executeChat: async (request) => {
          seen.request = request;
          return { text: 'ok' };
        },
        checkHealth: async (received) => {
          seen.context = received;
          return { status: 'healthy', message: 'ok' };
        },
      }),
      ensureSession: async (_provider, _context, options) => {
        seen.session = options;
        return { status: 'ready', source: 'reused' };
      },
      timeout: { timeoutMs: 100 },
    };
    const args =
      command === 'chat' ? ['chat', 'hello', '--provider', 'gemini'] : [command, 'gemini'];
    const code = await runCliProcess([...args, '--headless'], { emit() {} }, runtime);
    assert.equal(code, 0);
    if (command === 'health') {
      assert.equal(seen.context, context);
      return assert.equal(seen.context.configuration.headless, true);
    }
    assert.equal(seen.session.interactive, false);
    assert.equal(seen.session.visible, false);
    if (command === 'chat') assert.equal(seen.request.headless, true);
  });
}

for (const headless of [true, false]) {
  test(`Playwright chat launch honors headless=${headless}`, async () => {
    const { browser, calls } = playwrightGeminiBrowserFixture();
    const conversation = await browser.open(context, { headless });
    assert.equal(calls[0][2].headless, headless);
    await conversation.close();
  });
  test(`Playwright health launch honors headless=${headless}`, async () => {
    const { browser, calls } = playwrightGeminiBrowserFixture();
    await browser.health(context, { headless });
    assert.equal(calls[0][2].headless, headless);
    assert.ok(calls.includes('close-open'));
  });
}

for (const artifactFailure of [false, true]) {
  test(`hidden failed conversations close even when saving diagnostics fails=${artifactFailure}`, async () => {
    let closed = false;
    let launch;
    const adapter = createGeminiAdapter({
      inactivityMs: 100,
      browser: {
        open: async (_context, options) => {
          launch = options;
          return {
            submit: (_request, emit) => emit({ kind: 'error', message: 'Quota exceeded' }),
            persistFailure: async () => {
              if (artifactFailure) throw new Error('disk unavailable');
            },
            close: async () => {
              closed = true;
            },
          };
        },
      },
    });
    await assert.rejects(adapter.executeChat({ prompt: 'hello', headless: true }, context));
    assert.equal(launch.headless, true);
    assert.equal(closed, true);
  });
}
