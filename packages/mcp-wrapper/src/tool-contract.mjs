import * as z from 'zod/v4';
import { stringify } from 'yaml';

export const instructions =
  'LLMChat consults external providers on behalf of the user. When the user asks Gemini for analysis, a second opinion, or issue refinement, call chat with provider gemini. Include the actual issue text and relevant context in prompt: the provider cannot see this conversation or fetch GitHub issues. Use the response to fulfill the requested task; Codex reads and updates GitHub through its own tools. Do not invent support for unimplemented providers. Omit model and reasoning unless requested. Authentication is manual in a local terminal.';
const nonempty = z
  .string()
  .refine((value) => value.trim().length > 0, 'A nonempty value is required.');
export const provider = nonempty.describe(
  'Provider ID: gemini for Gemini, demo for offline examples. Other providers are not implemented yet.',
);
export const chatInput = {
  prompt: nonempty.describe(
    'Self-contained request including issue text, relevant context and desired outcome. The provider cannot see this Codex conversation.',
  ),
  provider: provider.optional(),
  model: nonempty.optional().describe('Exact provider model name; omit unless requested.'),
  reasoning: nonempty.optional().describe('Exact provider reasoning mode; omit unless requested.'),
  systemInstructions: nonempty
    .optional()
    .describe('Name of an existing provider preset (Gem), not arbitrary instruction text.'),
  disposableConversation: z
    .boolean()
    .default(true)
    .describe('Temporary conversation by default; false only when preservation is requested.'),
  outputFormat: z.enum(['text', 'json', 'jsonl', 'yaml']).optional(),
};

export function mcpResult(record, format = 'text') {
  return {
    content: [{ type: 'text', text: renderers[format](record) }],
    structuredContent: record,
    ...(record.status === 'failure' ? { isError: true } : {}),
  };
}

const renderers = {
  text: (record) =>
    record.status === 'failure'
      ? record.error.message
      : (record.response?.text ?? JSON.stringify(record.data)),
  json: (record) => JSON.stringify(record, null, 2),
  yaml: stringify,
  jsonl: (record) => {
    const { activity = [], ...terminal } = record;
    const events = activity.map((event) => ({
      schemaVersion: 1,
      type: 'activity',
      provider: record.provider,
      ...event,
    }));
    return [...events, terminal].map((event) => JSON.stringify(event)).join('\n');
  },
};

export function failure(error, format) {
  return mcpResult(
    {
      schemaVersion: 1,
      type: 'result',
      status: 'failure',
      error: { code: 'CHAT_FAILED', message: error.message },
    },
    format,
  );
}
