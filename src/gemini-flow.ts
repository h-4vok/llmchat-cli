import { runGeminiExecution } from './gemini-execution.js';

export type GeminiPromptRequest = {
  prompt: string;
  model?: string;
  reasoning?: string;
  disposableConversation?: boolean;
};

export type GeminiPromptResponse = {
  text: string;
  model?: string;
};

export type GeminiActivity = {
  kind: 'activity';
  message: string;
};

export type GeminiSignal =
  | GeminiActivity
  | { kind: 'response'; text: string; model?: string }
  | { kind: 'error'; message: string };

export type GeminiLocalDiagnostic = {
  state: string;
  message: string;
};

export interface GeminiPromptPort {
  submit(
    request: GeminiPromptRequest,
    emit: (signal: GeminiSignal) => void,
    signal: AbortSignal,
  ): void | Promise<void>;
  diagnoseLocally(): Promise<GeminiLocalDiagnostic>;
}

export type GeminiTimeoutScheduler = (expire: () => void, inactivityMs: number) => () => void;

export type GeminiFlowOptions = {
  inactivityMs: number;
  schedule?: GeminiTimeoutScheduler;
  onActivity?: (activity: GeminiActivity) => void;
  signal?: AbortSignal;
};

export { GeminiInactivityError, GeminiResponseError } from './gemini-execution.js';

export function executeGeminiPrompt(
  port: GeminiPromptPort,
  request: GeminiPromptRequest,
  options: GeminiFlowOptions,
): Promise<GeminiPromptResponse> {
  return runGeminiExecution(port, request, options);
}
