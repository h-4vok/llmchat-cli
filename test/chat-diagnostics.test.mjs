import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeChatWithContext } from '../dist/chat-execution.js';
import { persistTranscriptDiagnostic } from '../dist/chat-diagnostics.js';

const context = {
  profileDirectory: 'profile',
  diagnosticsDirectory: 'diagnostics',
  screenshotsDirectory: 'screenshots',
  configuration: {},
  notify() {},
};

function runtime(executeChat, records) {
  return {
    adapterFor: () => ({ provider: 'gemini', executeChat }),
    contextFor: () => context,
    recordChat: (_provider, transcript) => records.push(transcript),
    timeout: { timeoutMs: 100 },
  };
}

test('every successful and failed execution is offered to local diagnostics', async () => {
  const records = [];
  const request = { prompt: 'sensitive prompt' };
  await executeChatWithContext({
    runtime: runtime(async () => ({ text: 'sensitive response' }), records),
    provider: 'gemini',
    request,
    keepBrowserOpen: false,
  });
  await executeChatWithContext({
    runtime: runtime(async () => {
      throw new Error('provider failure');
    }, records),
    provider: 'gemini',
    request,
    keepBrowserOpen: false,
  });
  await executeChatWithContext({
    runtime: runtime(
      async () => ({
        text: 'response before close failure',
        async waitForClose() {
          throw new Error('close wait failed');
        },
      }),
      records,
    ),
    provider: 'gemini',
    request,
    keepBrowserOpen: true,
  });

  assert.equal(records.length, 3);
  assert.equal(records[0].options.prompt, 'sensitive prompt');
  assert.equal(records[0].response.text, 'sensitive response');
  assert.equal(records[1].status, 'failure');
  assert.equal(records[2].status, 'failure');
  assert.equal(records[2].response.text, 'response before close failure');
});

test('local transcript diagnostics persist prompt and available response content', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-transcript-'));
  const options = {
    input: { platform: 'win32', home: root, env: { LOCALAPPDATA: root } },
    accessControl: { secureDirectory: () => true, secureFile: () => true },
  };
  const success = {
    schemaVersion: 1,
    provider: 'gemini',
    options: { prompt: 'stored prompt' },
    activity: [],
    status: 'success',
    response: { text: 'stored response' },
  };
  persistTranscriptDiagnostic('gemini', success, options);
  persistTranscriptDiagnostic(
    'gemini',
    {
      ...success,
      status: 'failure',
      response: undefined,
      error: { code: 'CHAT_FAILED', message: 'failed' },
    },
    options,
  );

  const log = readFileSync(join(root, 'llmchat', 'logs', 'gemini', 'diagnostic.log'), 'utf8');
  assert.match(log, /stored prompt/);
  assert.match(log, /stored response/);
  assert.equal(log.trimEnd().split('\n').length, 2);
});
