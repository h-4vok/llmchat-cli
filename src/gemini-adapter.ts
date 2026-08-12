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
  type GeminiPromptPort,
  type GeminiPromptRequest,
} from './gemini-flow.js';
import { redactDiagnosticText } from './secret-redaction.js';

export interface GeminiConversation extends GeminiPromptPort {
  persistFailure(error: Error): Promise<void>;
  close(): Promise<void>;
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
    async executeChat(request, context) {
      const conversation = await options.browser.open(context);
      try {
        const response = await runConversation(
          conversation,
          request,
          context,
          options.inactivityMs,
        );
        await conversation.close();
        diagnostic = { state: 'progress', message: 'Gemini response completed.' };
        return { text: response.text };
      } catch (failure) {
        const error = asError(failure);
        diagnostic = { state: 'error', message: redactDiagnosticText(error.message) };
        await conversation.persistFailure(error);
        throw error;
      }
    },
    async diagnose() {
      return diagnostic;
    },
    checkHealth: (context) => options.browser.health(context),
  };
}

async function runConversation(
  conversation: GeminiConversation,
  request: ChatRequest,
  context: AdapterContext,
  inactivityMs: number,
): Promise<ChatResponse> {
  const prompt: GeminiPromptRequest = { prompt: request.prompt, model: request.model };
  return executeGeminiPrompt(conversation, prompt, {
    inactivityMs,
    onActivity: ({ message }) =>
      context.notify({ kind: 'progress', message: redactDiagnosticText(message) }),
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
