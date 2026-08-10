import { createHash } from 'node:crypto';

export const AGENT_SCHEMA = 'llmchat.agent-output/v1' as const;
export const WORKER_SCHEMA = 'llmchat.worker-output/v1' as const;
export const REVIEWER_SCHEMA = 'llmchat.reviewer-output/v1' as const;
export const ENVELOPE_BEGIN = '<<<llmchat.agent-output/v1>>>';
export const ENVELOPE_END = '<<<end llmchat.agent-output/v1>>>';

export type Role = 'worker' | 'qa' | 'staff';
export type Context = {
  run_id: string;
  issue: number;
  pr: number;
  round: number;
  commit: string;
  feedback_cursor: string;
};
export type Placement =
  | { kind: 'general' }
  | {
      kind: 'inline';
      path: string;
      commit: string;
      side: 'LEFT' | 'RIGHT';
      line: number;
      start_line?: number;
    };
export type ReviewArtifact = {
  schema: 'review.finding/v1' | 'review.note/v1' | 'review.summary/v1' | 'review.evidence/v1';
  id?: string;
  body: string;
  placement?: Placement;
  severity?: 'low' | 'medium' | 'high' | 'critical';
};
export type ReviewerOutput = {
  schema: typeof REVIEWER_SCHEMA;
  result: 'accepted' | 'changes_requested' | 'blocked';
  summary: string;
  evidence: string[];
  artifacts: ReviewArtifact[];
  dispositions: Record<string, 'continue' | 'resolve'>;
};
export type WorkerResolution = {
  finding_id: string;
  status: 'fixed' | 'answered' | 'not_fixed';
  response: string;
};
export type WorkerOutput = {
  schema: typeof WORKER_SCHEMA;
  status: 'ready_for_review' | 'blocked';
  resolutions: WorkerResolution[];
  evidence: string[];
  human_verification: {
    summary: string;
    steps: string[];
    expected: string[];
    isolation: string;
    limitations: string[];
    checklist: string[];
  };
};
export type Envelope = {
  schema: typeof AGENT_SCHEMA;
  message_id: string;
  producer: { role: Role };
  context: Context;
  output: ReviewerOutput | WorkerOutput;
};

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateEnvelope(
  value: unknown,
  expected?: Partial<Context> & { role?: Role },
): Envelope {
  if (!isRecord(value) || value.schema !== AGENT_SCHEMA || !nonEmpty(value.message_id))
    throw new Error('invalid agent envelope');
  const producer = value.producer;
  const context = value.context;
  if (!isRecord(producer) || !['worker', 'qa', 'staff'].includes(String(producer.role)))
    throw new Error('invalid producer role');
  if (
    !isRecord(context) ||
    !nonEmpty(context.run_id) ||
    !Number.isInteger(context.issue) ||
    !Number.isInteger(context.pr) ||
    !Number.isInteger(context.round) ||
    !/^[0-9a-f]{40}$/.test(String(context.commit)) ||
    !nonEmpty(context.feedback_cursor)
  )
    throw new Error('invalid agent context');
  const role = producer.role as Role;
  for (const [key, expectedValue] of Object.entries({ ...expected, role }))
    if (
      expectedValue !== undefined &&
      (key === 'role' ? role : context[key as keyof Context]) !== expectedValue
    )
      throw new Error(`agent context mismatch: ${key}`);
  const output = value.output;
  if (!isRecord(output) || output.schema !== (role === 'worker' ? WORKER_SCHEMA : REVIEWER_SCHEMA))
    throw new Error('invalid payload schema');
  if (role === 'worker') {
    if (
      !['ready_for_review', 'blocked'].includes(String(output.status)) ||
      !Array.isArray(output.resolutions) ||
      !Array.isArray(output.evidence) ||
      !isRecord(output.human_verification)
    )
      throw new Error('invalid worker output');
  } else if (
    !['accepted', 'changes_requested', 'blocked'].includes(String(output.result)) ||
    !nonEmpty(output.summary) ||
    !Array.isArray(output.evidence) ||
    !Array.isArray(output.artifacts) ||
    !isRecord(output.dispositions)
  )
    throw new Error('invalid reviewer output');
  return value as unknown as Envelope;
}

export function parseDelimitedEnvelope(
  stream: string,
  expected?: Partial<Context> & { role?: Role },
): Envelope {
  const matches = [
    ...stream.matchAll(new RegExp(`${ENVELOPE_BEGIN}\\s*([\\s\\S]*?)\\s*${ENVELOPE_END}`, 'g')),
  ];
  if (matches.length !== 1) throw new Error('expected exactly one delimited agent envelope');
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`malformed agent envelope: ${String(error)}`);
  }
  return validateEnvelope(parsed, expected);
}

export function envelopeHash(envelope: Envelope): string {
  return sha(JSON.stringify(envelope));
}
export function artifactKey(runId: string, role: Role, round: number, id: string): string {
  return sha(`${runId}:${role}:${round}:${id}`).slice(0, 32);
}
export function marker(key: string): string {
  return `<!-- llmchat-review-publish:v1 key=${key} -->`;
}
