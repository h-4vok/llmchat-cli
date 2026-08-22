import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { renderTranscript } from '../dist/transcript-renderer.js';

const success = {
  schemaVersion: 1,
  provider: 'gemini',
  options: { prompt: 'hello', keepBrowserOpen: false, disposableConversation: false },
  activity: [{ kind: 'progress', message: 'opening' }],
  status: 'success',
  response: { text: 'answer' },
};

test('JSON and YAML render one versioned terminal transcript', () => {
  assert.deepEqual(JSON.parse(renderTranscript(success, 'json')), success);
  assert.deepEqual(parseYaml(renderTranscript(success, 'yaml')), success);
  assert.equal(renderTranscript(success, 'text'), 'opening\nanswer\n');
});

test('JSONL renders ordered activity followed by exactly one terminal record', () => {
  const records = renderTranscript(success, 'jsonl').trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(records, [
    {
      schemaVersion: 1,
      type: 'activity',
      provider: 'gemini',
      kind: 'progress',
      message: 'opening',
    },
    {
      schemaVersion: 1,
      type: 'result',
      provider: 'gemini',
      options: success.options,
      status: 'success',
      response: { text: 'answer' },
    },
  ]);
});

test('structured failures expose one generic public code and message', () => {
  const failure = {
    ...success,
    activity: [],
    status: 'failure',
    response: undefined,
    error: { code: 'CHAT_FAILED', message: 'Provider session is required.' },
  };
  const json = JSON.parse(renderTranscript(failure, 'json'));
  assert.deepEqual(json.error, failure.error);
  assert.equal(JSON.stringify(json).includes('GEMINI_LOGIN_REQUIRED'), false);
  assert.equal(renderTranscript(failure, 'text'), 'Provider session is required.\n');
  const partialFailure = { ...failure, response: { text: 'answer before close failure' } };
  assert.equal(
    JSON.parse(renderTranscript(partialFailure, 'jsonl')).response.text,
    'answer before close failure',
  );
});
