import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
type InformationalReviewArtifact = {
  schema: 'review.note/v1' | 'review.summary/v1' | 'review.evidence/v1';
  id?: never;
  body: string;
  placement?: Placement;
  severity?: 'low' | 'medium' | 'high' | 'critical';
};
type ReviewFinding = {
  schema: 'review.finding/v1';
  id: string;
  body: string;
  placement: Placement;
  severity: 'low' | 'medium' | 'high' | 'critical';
};
export type ReviewArtifact = InformationalReviewArtifact | ReviewFinding;
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

export type EnvelopeValidationContext = Partial<Context> & {
  role?: Role;
  openFindingIds?: string[];
  allocatedFindingIds?: string[];
  openHumanFeedbackIds?: string[];
};

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function validatePlacement(value: unknown): asserts value is Placement {
  if (!isRecord(value) || !['general', 'inline'].includes(String(value.kind)))
    throw new Error('invalid artifact placement');
  if (value.kind === 'general') {
    if (Object.keys(value).some((key) => key !== 'kind'))
      throw new Error('invalid general placement');
    return;
  }
  if (
    !nonEmpty(value.path) ||
    value.path.startsWith('/') ||
    value.path.includes('\\') ||
    value.path.split('/').includes('..')
  )
    throw new Error('invalid inline path');
  if (
    !/^[0-9a-f]{40}$/.test(String(value.commit)) ||
    !['LEFT', 'RIGHT'].includes(String(value.side))
  )
    throw new Error('invalid inline placement');
  if (!Number.isInteger(value.line) || Number(value.line) < 1)
    throw new Error('invalid inline line');
  if (
    value.start_line !== undefined &&
    (!Number.isInteger(value.start_line) ||
      Number(value.start_line) < 1 ||
      Number(value.start_line) > Number(value.line))
  )
    throw new Error('invalid inline range');
}

type JsonSchema = Record<string, any>;
const schemaCache = new Map<string, JsonSchema>();
function checkedSchema(name: string): JsonSchema {
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const file = join(join(fileURLToPath(new URL('.', import.meta.url)), '..'), 'schemas', name);
  const schema = JSON.parse(readFileSync(file, 'utf8')) as JsonSchema;
  schemaCache.set(name, schema);
  return schema;
}

function schemaType(value: unknown, type: string): boolean {
  return type === 'object'
    ? isRecord(value)
    : type === 'array'
      ? Array.isArray(value)
      : type === 'string'
        ? typeof value === 'string'
        : type === 'integer'
          ? Number.isInteger(value)
          : type === 'number'
            ? typeof value === 'number'
            : type === 'boolean'
              ? typeof value === 'boolean'
              : true;
}

function validateJsonSchema(value: unknown, schema: JsonSchema, path = '$'): void {
  if (schema.$ref) {
    const ref = String(schema.$ref).split('/').at(-1);
    if (ref && ref.startsWith('llmchat.')) {
      validateJsonSchema(
        value,
        checkedSchema(ref.replace('llmchat.', '').replace('/v1', '-v1') + '.json'),
        path,
      );
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const)
    throw new Error(`schema mismatch at ${path}`);
  if (schema.enum && !schema.enum.includes(value))
    throw new Error(`schema enum mismatch at ${path}`);
  if (schema.type && !schemaType(value, schema.type))
    throw new Error(`schema type mismatch at ${path}`);
  if (
    schema.minLength !== undefined &&
    (typeof value !== 'string' || value.length < schema.minLength)
  )
    throw new Error(`schema minLength mismatch at ${path}`);
  if (schema.minimum !== undefined && (typeof value !== 'number' || value < schema.minimum))
    throw new Error(`schema minimum mismatch at ${path}`);
  if (schema.pattern && (typeof value !== 'string' || !new RegExp(schema.pattern).test(value)))
    throw new Error(`schema pattern mismatch at ${path}`);
  if (
    schema.oneOf &&
    !schema.oneOf.some((candidate: JsonSchema) => {
      try {
        validateJsonSchema(value, candidate, path);
        return true;
      } catch {
        return false;
      }
    })
  )
    throw new Error(`schema oneOf mismatch at ${path}`);
  if (schema.if) {
    let matches = true;
    try {
      validateJsonSchema(value, schema.if, path);
    } catch {
      matches = false;
    }
    const branch = matches ? schema.then : schema.else;
    if (branch) validateJsonSchema(value, branch, path);
  }
  if (schema.type === 'array' && schema.items)
    (value as unknown[]).forEach((item, index) =>
      validateJsonSchema(item, schema.items, `${path}[${index}]`),
    );
  if (schema.type === 'object') {
    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? [])
      if (!(required in object))
        throw new Error(`schema required field missing at ${path}.${required}`);
    for (const [key, item] of Object.entries(object)) {
      const child = schema.properties?.[key];
      if (!child && schema.additionalProperties === false)
        throw new Error(`schema additional field at ${path}.${key}`);
      if (child) validateJsonSchema(item, child as JsonSchema, `${path}.${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        validateJsonSchema(item, schema.additionalProperties as JsonSchema, `${path}.${key}`);
    }
  }
}

function validateCheckedSchemas(value: Record<string, unknown>, role: Role): void {
  validateJsonSchema(value, checkedSchema('agent-output-v1.json'));
  validateJsonSchema(
    value.output,
    checkedSchema(role === 'worker' ? 'worker-output-v1.json' : 'reviewer-output-v1.json'),
  );
}

function validateReviewerOutput(
  output: Record<string, unknown>,
  role: Role,
  expected: EnvelopeValidationContext = {},
): void {
  if (
    !['accepted', 'changes_requested', 'blocked'].includes(String(output.result)) ||
    !nonEmpty(output.summary) ||
    !Array.isArray(output.evidence) ||
    !output.evidence.every(nonEmpty) ||
    !Array.isArray(output.artifacts) ||
    !isRecord(output.dispositions)
  )
    throw new Error('invalid reviewer output');
  const ids = new Set<string>();
  let actionable = 0;
  for (const artifact of output.artifacts) {
    if (
      !isRecord(artifact) ||
      !['review.finding/v1', 'review.note/v1', 'review.summary/v1', 'review.evidence/v1'].includes(
        String(artifact.schema),
      ) ||
      !nonEmpty(artifact.body)
    )
      throw new Error('invalid review artifact');
    const id = artifact.id;
    if (artifact.schema === 'review.finding/v1') {
      const prefix = role === 'qa' ? 'Q' : 'S';
      if (typeof id !== 'string' || !new RegExp(`^${prefix}\\d+$`).test(id) || ids.has(id))
        throw new Error('invalid or duplicate finding id');
      if (!['low', 'medium', 'high', 'critical'].includes(String(artifact.severity)))
        throw new Error('review finding severity is required');
      if (artifact.placement === undefined) throw new Error('review finding placement is required');
      validatePlacement(artifact.placement);
      actionable++;
    } else if (id !== undefined) {
      throw new Error('informational review artifact id must be omitted');
    }
    if (typeof id === 'string') ids.add(id);
    if (artifact.schema !== 'review.finding/v1' && artifact.placement !== undefined)
      validatePlacement(artifact.placement);
  }
  const open = new Set(expected.openFindingIds ?? []);
  const openHuman = new Set(expected.openHumanFeedbackIds ?? []);
  const allowedDispositions = new Set(
    role === 'qa'
      ? [...open].filter((id) => id.startsWith('Q'))
      : [
          ...[...open].filter((id) => id.startsWith('S')),
          ...[...openHuman].filter((id) => id.startsWith('H')),
        ],
  );
  const lifecycleKnown =
    expected.openFindingIds !== undefined || expected.openHumanFeedbackIds !== undefined;
  for (const [id, disposition] of Object.entries(output.dispositions)) {
    if (!/^[QSH]\d+$/.test(id) || !['continue', 'resolve'].includes(String(disposition)))
      throw new Error('invalid reviewer disposition');
    if (role === 'qa' ? !id.startsWith('Q') : !id.startsWith('S') && !id.startsWith('H'))
      throw new Error('reviewer disposition ownership mismatch');
    if (lifecycleKnown && !allowedDispositions.has(id))
      throw new Error(`unknown reviewer disposition: ${id}`);
  }
  const dispositions = output.dispositions as Record<string, string>;
  for (const id of open) {
    if (role === 'qa' && !id.startsWith('Q')) continue;
    if (role === 'staff' && !id.startsWith('S')) continue;
    if (!(id in dispositions) && output.result !== 'accepted')
      throw new Error(`missing disposition for open finding ${id}`);
  }
  const allocated = new Set(expected.allocatedFindingIds ?? []);
  for (const artifact of output.artifacts as Array<Record<string, unknown>>) {
    if (artifact.schema !== 'review.finding/v1' || typeof artifact.id !== 'string') continue;
    if (allocated.has(artifact.id) && !open.has(artifact.id))
      throw new Error(`finding id was already allocated: ${artifact.id}`);
  }
  if (role === 'staff')
    for (const id of openHuman)
      if (!(id in dispositions)) throw new Error(`missing disposition for open feedback ${id}`);
  const continued = Object.entries(dispositions).filter(
    ([id, disposition]) =>
      disposition === 'continue' &&
      (role === 'qa' ? id.startsWith('Q') : id.startsWith('S') || id.startsWith('H')),
  ).length;
  if (output.result === 'accepted' && (actionable > 0 || continued > 0))
    throw new Error('accepted reviewer output has actionable findings');
  if (output.result === 'changes_requested' && actionable + continued === 0)
    throw new Error('changes_requested requires a finding');
  if (output.result === 'blocked' && actionable > 0)
    throw new Error('blocked reviewer output cannot route findings');
}

function validateWorkerOutput(
  output: Record<string, unknown>,
  expected: EnvelopeValidationContext = {},
): void {
  if (
    !['ready_for_review', 'blocked'].includes(String(output.status)) ||
    !Array.isArray(output.resolutions) ||
    !Array.isArray(output.evidence) ||
    !output.evidence.every(nonEmpty) ||
    !isRecord(output.human_verification)
  )
    throw new Error('invalid worker output');
  const guide = output.human_verification;
  for (const key of ['summary', 'isolation'])
    if (!nonEmpty(guide[key])) throw new Error('invalid human verification guide');
  for (const key of ['steps', 'expected', 'limitations', 'checklist'])
    if (!Array.isArray(guide[key]) || !guide[key].every(nonEmpty))
      throw new Error('invalid human verification guide');
  const ids = new Set<string>();
  const known = new Set(expected.openFindingIds ?? []);
  for (const resolution of output.resolutions) {
    if (
      !isRecord(resolution) ||
      !/^[QS]\d+$/.test(String(resolution.finding_id)) ||
      ids.has(String(resolution.finding_id)) ||
      !['fixed', 'answered', 'not_fixed'].includes(String(resolution.status)) ||
      !nonEmpty(resolution.response)
    )
      throw new Error('invalid worker resolution');
    if (!known.has(String(resolution.finding_id)))
      throw new Error(`unknown worker finding reference: ${String(resolution.finding_id)}`);
    ids.add(String(resolution.finding_id));
  }
}

export function validateEnvelope(
  value: unknown,
  expected: EnvelopeValidationContext = {},
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
  validateCheckedSchemas(value, role);
  if (expected.role !== undefined && expected.role !== role)
    throw new Error('agent context mismatch: role');
  for (const [key, expectedValue] of Object.entries(expected).filter(([key]) =>
    ['run_id', 'issue', 'pr', 'round', 'commit', 'feedback_cursor'].includes(key),
  ))
    if (expectedValue !== undefined && context[key as keyof Context] !== expectedValue)
      throw new Error(`agent context mismatch: ${key}`);
  const output = value.output;
  if (!isRecord(output) || output.schema !== (role === 'worker' ? WORKER_SCHEMA : REVIEWER_SCHEMA))
    throw new Error('invalid payload schema');
  if (role === 'worker') validateWorkerOutput(output, expected);
  else validateReviewerOutput(output, role, expected);
  return value as unknown as Envelope;
}

export function parseDelimitedEnvelope(
  stream: string,
  expected?: EnvelopeValidationContext,
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
