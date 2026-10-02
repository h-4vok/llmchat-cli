import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCliProcess } from '../dist/cli-app.js';

test('a literal output option inside the prompt leaves CLI output in text mode', async () => {
  const events = [];
  const runtime = {
    contextFor: () => ({}),
    adapterFor: () => ({ executeChat: async (request) => ({ text: request.prompt }) }),
    timeout: { timeoutMs: 1000 },
  };
  const code = await runCliProcess(
    ['chat', '--provider', 'demo', '--', '--output', 'jsonl'],
    {
      emit: (event) => events.push(event),
      raw() {
        throw new Error('must remain text');
      },
    },
    runtime,
  );
  assert.equal(code, 0);
  assert.equal(events[0].message, '--output jsonl');
});
