import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runCodex } from '../../test-support/codex-live-runner.mjs';

const scenarios = [
  {
    name: 'explicit LLMChat request',
    token: 'codex-explicit',
    disposable: true,
    prompt:
      'Usá LLMChat con el provider demo para preguntarle exactamente "codex-explicit". Respondé con la respuesta del provider.',
    assertArguments(args) {
      assert.equal(args.provider, 'demo');
      assert.equal(args.prompt, 'codex-explicit');
      assert.equal(Object.hasOwn(args, 'model'), false);
      assert.equal(Object.hasOwn(args, 'reasoning'), false);
    },
  },
  {
    name: 'natural external provider consultation',
    token: 'codex-natural',
    disposable: true,
    prompt:
      'Consultá al provider demo para obtener su respuesta exacta a "codex-natural" y devolvémela.',
    assertArguments(args) {
      assert.equal(args.provider, 'demo');
      assert.equal(args.prompt, 'codex-natural');
    },
  },
  {
    name: 'explicit model reasoning and retained conversation',
    token: 'codex-options',
    disposable: false,
    prompt:
      'Usá LLMChat con provider demo, model "test-model" y reasoning "test-reasoning" para preguntar "codex-options". La conversación no debe ser disposable.',
    assertArguments(args) {
      assert.equal(args.provider, 'demo');
      assert.equal(args.prompt, 'codex-options');
      assert.equal(args.model, 'test-model');
      assert.equal(args.reasoning, 'test-reasoning');
      assert.equal(args.disposableConversation, false);
    },
  },
];

for (const scenario of scenarios) {
  test(`Codex calls ask_llm for ${scenario.name}`, { timeout: 180_000 }, async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'llmchat-codex-mcp-'));
    try {
      const events = await runCodex(scenario.prompt, temporaryRoot);
      const call = completedMcpCall(events);
      const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      const transcript = structuredTranscript(call);
      assert.equal(call.server, 'llmchat_test');
      assert.equal(call.tool, 'ask_llm');
      assert.equal(call.status, 'completed');
      scenario.assertArguments(args);
      assert.equal(transcript.provider, 'demo');
      assert.equal(transcript.options.disposableConversation, scenario.disposable);
      assert.equal(transcript.response.text, `Demo response: ${scenario.token}`);
      assert.deepEqual(transcript.activity, []);
      assert.equal(textResult(call), `Demo response: ${scenario.token}`);
      assert.doesNotMatch(JSON.stringify(call.result), /Gemini|browser/i);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
}

function completedMcpCall(events) {
  const event = events.find(
    (candidate) => candidate.type === 'item.completed' && candidate.item?.type === 'mcp_tool_call',
  );
  assert.ok(event, `Codex emitted no completed MCP call:\n${JSON.stringify(events, null, 2)}`);
  return event.item;
}

function structuredTranscript(call) {
  const transcript = call.result?.structured_content ?? call.result?.structuredContent;
  assert.ok(transcript, `MCP call has no structured transcript: ${JSON.stringify(call)}`);
  return transcript;
}

function textResult(call) {
  const content = call.result?.content?.find((item) => item.type === 'text');
  assert.ok(content, `MCP result has no text content: ${JSON.stringify(call.result)}`);
  return content.text;
}
