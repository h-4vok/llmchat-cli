import * as z from 'zod/v4';

export class ProcessProtocolError extends Error {}

const resultSchema = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(1),
      type: z.literal('result'),
      status: z.literal('success'),
      response: z.object({ text: z.string() }).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .refine((record) => record.response !== undefined || record.data !== undefined),
  z
    .object({
      schemaVersion: z.literal(1),
      type: z.literal('result'),
      status: z.literal('failure'),
      error: z.object({ code: z.string(), message: z.string() }),
    })
    .passthrough(),
]);
const activitySchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('activity'),
    kind: z.enum(['progress', 'warning']),
    message: z.string(),
  })
  .passthrough();

export function parseResult(stdout, stderr, code) {
  const records = stdout.trim() ? stdout.trim().split(/\r?\n/).map(parseLine) : [];
  const result = validateTerminal(requireTerminal(records, stderr));
  validateExit(result, code, stderr);
  return { ...result, activity: records.slice(0, -1).map(validateActivity) };
}

function requireTerminal(records, stderr) {
  const terminal = records.at(-1);
  if (!terminal || terminal.type !== 'result')
    throw new ProcessProtocolError(
      `llmchat returned no terminal JSONL record.${diagnostic(stderr)}`,
    );
  return terminal;
}

function validateExit(result, code, stderr) {
  if (code !== 0 && result.status !== 'failure')
    throw new ProcessProtocolError(`llmchat exited with code ${code}.${diagnostic(stderr)}`);
}

function validateTerminal(record) {
  if (record.schemaVersion !== 1)
    throw new ProcessProtocolError(`Unsupported llmchat schemaVersion: ${record.schemaVersion}.`);
  const result = resultSchema.safeParse(record);
  if (!result.success)
    throw new ProcessProtocolError(`Invalid llmchat result: ${result.error.message}`);
  return result.data;
}

function validateActivity(record) {
  const result = activitySchema.safeParse(record);
  if (!result.success)
    throw new ProcessProtocolError(`Invalid llmchat activity: ${result.error.message}`);
  return { kind: result.data.kind, message: result.data.message };
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new ProcessProtocolError(
      'Invalid llmchat JSONL record. Expected one JSON object per line.',
    );
  }
}

function diagnostic(stderr) {
  return stderr ? ` stderr: ${stderr.trim()}` : '';
}
