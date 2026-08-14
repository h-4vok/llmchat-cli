import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureBrowserSession } from '../dist/browser-session.js';
import {
  browserSessionRequest as request,
  createBrowserSessionPorts as createPorts,
} from '../test-support/browser-session-fixture.mjs';

test('login has no timeout and stays open until a terminal observation', async () => {
  let release;
  const terminalObservation = new Promise((resolve) => {
    release = resolve;
  });
  const ports = createPorts('missing', [terminalObservation]);
  let settled = false;
  const execution = ensureBrowserSession(request, ports).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(ports.closeCalls(), 0);
  release('usable');
  assert.deepEqual(await execution, { status: 'ready', source: 'authenticated' });
});

test('independent executions do not reuse in-memory session state', async () => {
  const first = createPorts('missing', ['usable']);
  const second = createPorts('missing', ['usable']);
  await Promise.all([ensureBrowserSession(request, first), ensureBrowserSession(request, second)]);
  assert.equal(first.calls.filter((call) => Array.isArray(call) && call[0] === 'notify').length, 1);
  assert.equal(
    second.calls.filter((call) => Array.isArray(call) && call[0] === 'notify').length,
    1,
  );
});
