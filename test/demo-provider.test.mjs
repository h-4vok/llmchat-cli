import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoAdapter } from '../dist/demo-adapter.js';
import { runCliProcess } from '../dist/cli-app.js';
import { createRealChatRuntime } from '../dist/real-chat-runtime.js';

const paths = {
  profileDirectory: '/profiles/provider',
  diagnosticsDirectory: '/diagnostics/provider',
  screenshotsDirectory: '/screenshots/provider',
};

test('demo answers deterministically without interpreting provider options', async () => {
  const adapter = createDemoAdapter();
  const response = await adapter.executeChat({
    prompt: 'hola que tal',
    model: 'anything',
    reasoning: 'anything',
    systemInstructions: 'anything',
    disposableConversation: true,
  });

  assert.equal(adapter.provider, 'demo');
  assert.deepEqual(response, { text: 'Demo response: hola que tal' });
});

test('demo reports local health and rejects browser-only behaviour', async () => {
  const adapter = createDemoAdapter();

  assert.deepEqual(await adapter.checkHealth(), {
    status: 'healthy',
    message: 'Demo provider is ready.',
  });
  assert.deepEqual(await adapter.diagnose(), {
    state: 'progress',
    message: 'Demo provider is ready.',
  });
  await assert.rejects(
    adapter.executeChat({ prompt: 'hello', keepBrowserOpen: true }),
    /does not use a browser/,
  );
});

test('production runtime routes demo without invoking Gemini or a browser session', async () => {
  let geminiCalls = 0;
  let sessionCalls = 0;
  let recorded;
  const runtime = createRealChatRuntime({
    provisionStorage: () => paths,
    adapter: {
      provider: 'gemini',
      async executeChat() {
        geminiCalls += 1;
        return { text: 'gemini' };
      },
      async diagnose() {
        return { state: 'progress', message: 'ready' };
      },
      async checkHealth() {
        return { status: 'healthy', message: 'ready' };
      },
    },
    sessionPorts: {
      browser: {
        async checkSession() {
          sessionCalls += 1;
          return 'usable';
        },
        async openLoginBrowser() {
          throw new Error('browser must not open');
        },
      },
      notifications: { async send() {} },
    },
    recordChat: (provider, transcript) => {
      recorded = { provider, transcript };
    },
  });
  const events = [];

  const status = await runCliProcess(
    ['chat', 'hola que tal', '--provider', 'demo'],
    { emit: (event) => events.push(event) },
    runtime,
  );

  assert.equal(status, 0);
  assert.deepEqual(events, [{ speaker: 'demo', message: 'Demo response: hola que tal' }]);
  assert.equal(geminiCalls, 0);
  assert.equal(sessionCalls, 0);
  assert.equal(recorded.provider, 'demo');
  assert.equal(recorded.transcript.response.text, 'Demo response: hola que tal');
  const session = await runtime.ensureSession('demo', runtime.contextFor('demo'));
  assert.deepEqual(session, { status: 'ready', source: 'reused' });
  assert.equal(sessionCalls, 0);
});

test('demo auth is explicitly unnecessary and never ensures a session', async () => {
  let sessionCalls = 0;
  const runtime = createRealChatRuntime({
    provisionStorage: () => paths,
    recordChat: () => {},
    sessionPorts: {
      browser: {
        async checkSession() {
          sessionCalls += 1;
          return 'usable';
        },
        async openLoginBrowser() {
          throw new Error('unused');
        },
      },
      notifications: { async send() {} },
    },
  });
  const events = [];

  assert.equal(
    await runCliProcess(['auth', 'demo'], { emit: (event) => events.push(event) }, runtime),
    0,
  );
  assert.deepEqual(events, [
    { speaker: 'llmchat', message: 'Provider demo does not require authentication.' },
  ]);
  assert.equal(sessionCalls, 0);
});
