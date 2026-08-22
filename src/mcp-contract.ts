import * as z from 'zod/v4';
import type { ExecutionTranscript } from './execution-transcript.js';
import { supportedProviders } from './supported-providers.js';

export const mcpInstructions =
  'LLMChat lets Codex consult external LLM providers. When the user asks to use LLMChat, ask or consult Gemini, delegate work to Gemini, or get a second opinion from Gemini, call ask_llm. Select provider gemini when Gemini is named; otherwise omit provider to use the CLI default. Omit model and reasoning unless the user explicitly requests them. Conversations are disposable by default; set disposableConversation to false only when the user asks to preserve the conversation.';

export const askLlmInput = {
  prompt: z.string().min(1).describe('The exact request to send to the external LLM.'),
  provider: z
    .enum(supportedProviders)
    .optional()
    .describe('External LLM provider. Omit it to use the default configured by the CLI.'),
  model: z
    .string()
    .optional()
    .describe('Exact provider-visible model name. Omit unless the user requests a model.'),
  reasoning: z
    .string()
    .optional()
    .describe('Exact provider-specific reasoning mode. Omit unless the user requests one.'),
  disposableConversation: z
    .boolean()
    .default(true)
    .describe('Use an isolated disposable conversation unless the user asks to preserve it.'),
};

const requestOptions = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  reasoning: z.string().optional(),
  disposableConversation: z.boolean(),
});

export const askLlmOutput = {
  schemaVersion: z.literal(1),
  provider: z.string(),
  options: requestOptions,
  activity: z.array(z.object({ kind: z.enum(['progress', 'warning']), message: z.string() })),
  status: z.enum(['success', 'failure']),
  response: z.object({ text: z.string() }).optional(),
  error: z.object({ code: z.literal('CHAT_FAILED'), message: z.string() }).optional(),
};

export function mcpResult(transcript: ExecutionTranscript) {
  const text =
    transcript.status === 'success' ? transcript.response.text : transcript.error.message;
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: { ...transcript },
    ...(transcript.status === 'failure' ? { isError: true } : {}),
  };
}
