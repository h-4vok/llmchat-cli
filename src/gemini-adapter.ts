import type {
  AdapterContext,
  AdapterDiagnostic,
  AdapterHealth,
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from './adapter-contract.js';
import {
  executeGeminiPrompt,
  GeminiInactivityError,
  type GeminiPromptPort,
  type GeminiPromptRequest,
} from './gemini-flow.js';
import { redactDiagnosticText } from './secret-redaction.js';

export interface GeminiConversation extends GeminiPromptPort {
  persistFailure(error: Error): Promise<void>;
  close(): Promise<void>;
  waitForClose(): Promise<void>;
}

export interface GeminiBrowserPort {
  open(context: AdapterContext): Promise<GeminiConversation>;
  health(context: AdapterContext): Promise<AdapterHealth>;
}

export type GeminiAdapterOptions = {
  browser: GeminiBrowserPort;
  inactivityMs: number;
};

export function createGeminiAdapter(options: GeminiAdapterOptions): ProviderAdapter {
  let diagnostic: AdapterDiagnostic = { state: 'progress', message: 'Gemini is idle.' };
  return {
    provider: 'gemini',
    async executeChat(request, context, signal = new AbortController().signal) {
      const conversation = await options.browser.open(context);
      try {
        const response = await runConversation(conversation, request, {
          context,
          inactivityMs: options.inactivityMs,
          signal,
        });
        const result = await completeConversation(conversation, request, response);
        diagnostic = { state: 'progress', message: 'Gemini response completed.' };
        return result;
      } catch (failure) {
        const error = asError(failure);
        diagnostic = { state: 'error', message: redactDiagnosticText(error.message) };
        await handleFailure(conversation, error, signal);
        throw error;
      }
    },
    async diagnose() {
      return diagnostic;
    },
    checkHealth: (context) => options.browser.health(context),
  };
}

async function completeConversation(
  conversation: GeminiConversation,
  request: ChatRequest,
  response: ChatResponse,
): Promise<ChatResponse> {
  if (!request.keepBrowserOpen) await conversation.close();
  const waitForClose = request.keepBrowserOpen ? () => conversation.waitForClose() : undefined;
  return { text: response.text, ...(waitForClose ? { waitForClose } : {}) };
}

async function handleFailure(
  conversation: GeminiConversation,
  error: Error,
  signal: AbortSignal,
): Promise<void> {
  await conversation.persistFailure(error);
  if (shouldCloseAfterFailure(error, signal)) await conversation.close();
}

function shouldCloseAfterFailure(error: Error, signal: AbortSignal): boolean {
  return signal.aborted || error instanceof GeminiInactivityError;
}

type ConversationRunOptions = {
  context: AdapterContext;
  inactivityMs: number;
  signal: AbortSignal;
};

async function runConversation(
  conversation: GeminiConversation,
  request: ChatRequest,
  options: ConversationRunOptions,
): Promise<ChatResponse> {
  const prompt: GeminiPromptRequest = {
    prompt: request.prompt,
    model: request.model,
  };
  if (request.reasoning !== undefined) prompt.reasoning = request.reasoning;
  if (request.disposableConversation !== undefined)
    prompt.disposableConversation = request.disposableConversation;
  return executeGeminiPrompt(conversation, prompt, {
    inactivityMs: options.inactivityMs,
    signal: options.signal,
    onActivity: ({ message }) =>
      options.context.notify({ kind: 'progress', message: redactDiagnosticText(message) }),
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
