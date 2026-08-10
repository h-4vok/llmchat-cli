import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGENT_SCHEMA,
  ENVELOPE_BEGIN,
  ENVELOPE_END,
  parseDelimitedEnvelope,
  validateEnvelope,
} from '../dist/agent-output.js';
import { buildDiffIndex, placement, publishArtifact } from '../dist/review-publication.js';

const context = {
  run_id: 'run-1',
  issue: 25,
  pr: 50,
  round: 1,
  commit: 'a'.repeat(40),
  feedback_cursor: 'cursor-1',
};
const envelope = {
  schema: AGENT_SCHEMA,
  message_id: 'message-1',
  producer: { role: 'qa' },
  context,
  output: {
    schema: 'llmchat.reviewer-output/v1',
    result: 'accepted',
    summary: 'ok',
    evidence: ['test'],
    artifacts: [],
    dispositions: {},
  },
};

test('structured envelopes validate and delimited fallback ignores stream text', () => {
  assert.deepEqual(validateEnvelope(envelope, { ...context, role: 'qa' }), envelope);
  const framed = `visible log\n${ENVELOPE_BEGIN}\n${JSON.stringify(envelope)}\n${ENVELOPE_END}\nmore log`;
  assert.deepEqual(parseDelimitedEnvelope(framed, { ...context, role: 'qa' }), envelope);
  assert.throws(
    () =>
      parseDelimitedEnvelope(
        `${ENVELOPE_BEGIN}${JSON.stringify(envelope)}${ENVELOPE_END}${ENVELOPE_BEGIN}${JSON.stringify(envelope)}${ENVELOPE_END}`,
      ),
    /exactly one/,
  );
});

test('state-aware reviewer validation requires lifecycle dispositions and unique findings', () => {
  const finding = {
    ...envelope,
    message_id: 'message-q1',
    output: {
      ...envelope.output,
      result: 'changes_requested',
      artifacts: [
        {
          schema: 'review.finding/v1',
          id: 'Q1',
          body: 'fix',
          placement: { kind: 'general' },
        },
      ],
    },
  };
  assert.throws(
    () =>
      validateEnvelope(
        {
          ...envelope,
          output: { ...envelope.output, result: 'accepted' },
        },
        { ...context, role: 'qa', openFindingIds: ['Q1'] },
      ),
    /missing disposition/,
  );
  assert.throws(
    () =>
      validateEnvelope(
        {
          ...finding,
          message_id: 'message-q1-reused',
        },
        { ...context, role: 'qa', allocatedFindingIds: ['Q1'], openFindingIds: [] },
      ),
    /already allocated/,
  );
  assert.throws(
    () =>
      validateEnvelope(
        {
          ...envelope,
          output: { ...envelope.output, unexpected: true },
        },
        { ...context, role: 'qa' },
      ),
    /schema additional field/,
  );
});

test('Worker resolution references must exist in persisted reviewer findings', () => {
  const worker = {
    ...envelope,
    message_id: 'worker-message',
    producer: { role: 'worker' },
    output: {
      schema: 'llmchat.worker-output/v1',
      status: 'ready_for_review',
      resolutions: [{ finding_id: 'Q9', status: 'fixed', response: 'done' }],
      evidence: ['test'],
      human_verification: {
        summary: 'summary',
        steps: ['step'],
        expected: ['expected'],
        isolation: 'temp',
        limitations: ['diagnostic'],
        checklist: ['check'],
      },
    },
  };
  assert.throws(
    () =>
      validateEnvelope(worker, {
        ...context,
        role: 'worker',
        allocatedFindingIds: ['Q1'],
        openFindingIds: ['Q1'],
      }),
    /unknown worker finding reference/,
  );
});

test('placement validates sides and every line in a range', () => {
  const index = buildDiffIndex([
    { path: 'src/a.ts', side: 'LEFT', line: 4 },
    { path: 'src/a.ts', side: 'RIGHT', line: 10 },
    { path: 'src/a.ts', side: 'RIGHT', line: 11 },
  ]);
  const left = placement(
    {
      schema: 'review.finding/v1',
      id: 'Q1',
      body: 'left',
      placement: {
        kind: 'inline',
        path: 'src/a.ts',
        commit: context.commit,
        side: 'LEFT',
        line: 4,
      },
    },
    context.commit,
    index,
  );
  assert.equal(left.kind, 'inline');
  assert.equal(left.side, 'LEFT');
  const mixed = placement(
    {
      schema: 'review.finding/v1',
      id: 'Q2',
      body: 'mixed',
      placement: {
        kind: 'inline',
        path: 'src/a.ts',
        commit: context.commit,
        side: 'RIGHT',
        start_line: 10,
        line: 12,
      },
    },
    context.commit,
    index,
  );
  assert.equal(mixed.kind, 'general');
  assert.match(mixed.reason, /range/);
});

test('publication has stable marker and falls back without losing the finding', () => {
  const artifact = {
    schema: 'review.finding/v1',
    id: 'Q1',
    body: 'Keep the full finding',
    placement: {
      kind: 'inline',
      path: 'missing.ts',
      commit: context.commit,
      side: 'RIGHT',
      line: 1,
    },
  };
  const first = publishArtifact(
    artifact,
    { runId: context.run_id, role: 'qa', round: 1, commit: context.commit },
    new Map(),
  );
  const second = publishArtifact(
    artifact,
    { runId: context.run_id, role: 'qa', round: 1, commit: context.commit },
    new Map(),
  );
  assert.equal(first.kind, 'general');
  assert.equal(first.body, second.body);
  assert.match(first.body, /llmchat-review-publish:v1 key=/);
  assert.match(first.body, /Keep the full finding/);
});
