import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';

test('wrapper mode checks authentication without allowing an interactive login', async (t) => {
  const previous = process.env.LLMCHAT_NON_INTERACTIVE;
  process.env.LLMCHAT_NON_INTERACTIVE = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.LLMCHAT_NON_INTERACTIVE;
    else process.env.LLMCHAT_NON_INTERACTIVE = previous;
  });
  for (const args of [
    ['auth', 'gemini'],
    ['chat', 'hello', '--provider', 'gemini'],
  ]) {
    const options = [];
    const raw = [];
    const code = await runCliProcess(
      [...args, '--output', 'jsonl'],
      {
        emit() {},
        raw: (value) => raw.push(value),
      },
      {
        contextFor: () => ({}),
        ensureSession: async (_provider, _context, request) => {
          options.push(request);
          return { status: 'authentication-required' };
        },
        adapterFor() {
          throw new Error('must not submit');
        },
      },
    );
    assert.equal(code, 1);
    assert.equal(options[0].interactive, false);
    assert.match(JSON.parse(raw.at(-1)).error.message, /llmchat auth gemini/);
  }
});
