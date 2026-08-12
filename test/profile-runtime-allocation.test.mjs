import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPersistentProfileAllocator } from '../dist/persistent-profile-allocation.js';
import { createRealChatRuntime } from '../dist/real-chat-runtime.js';

test('runtime derives one leased path for session probing and the interactive adapter', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-profile-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stable = join(root, 'profiles', 'gemini');
  mkdirSync(stable, { recursive: true });
  const allocator = createPersistentProfileAllocator();
  const occupied = allocator.acquire(stable);
  const paths = [];
  const adapter = {
    provider: 'gemini',
    async executeChat(_request, context) {
      paths.push(['adapter', context.profileDirectory]);
      return { text: 'done' };
    },
    async diagnose() {
      return { state: 'progress', message: 'ready' };
    },
    async checkHealth() {
      return { status: 'healthy', message: 'ready' };
    },
  };
  const runtime = createRealChatRuntime({
    provisionStorage: () => ({
      profileDirectory: stable,
      diagnosticsDirectory: join(stable, 'diagnostics'),
      screenshotsDirectory: join(stable, 'screenshots'),
    }),
    profileAllocator: allocator,
    adapter,
    sessionPorts: {
      browser: {
        async checkSession(request) {
          paths.push(['session', request.profileDirectory]);
          return 'usable';
        },
        async openLoginBrowser() {
          assert.fail('usable profile must not open login');
        },
      },
      notifications: { send: async () => {} },
    },
  });
  const context = runtime.contextFor('gemini');
  await runtime.ensureSession('gemini', context);
  await runtime.ensureSession('gemini', context);
  await runtime.adapterFor('gemini').executeChat({ prompt: 'hello' }, context);

  assert.deepEqual(paths, [
    ['session', `${stable}.concurrent-1`],
    ['session', `${stable}.concurrent-1`],
    ['adapter', `${stable}.concurrent-1`],
  ]);
  await runtime.releaseContext(context);
  occupied.release();
});
