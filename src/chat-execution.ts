import type { ChatRequest } from './adapter-contract.js';
import { executeChat } from './chat-command.js';
import type { ChatRuntime } from './chat-runtime.js';
import { createFailureTranscript, type ExecutionTranscript } from './execution-transcript.js';
import type { Output } from './output.js';
import type { Provider } from './supported-providers.js';

export type ContextualChatInput = {
  runtime: ChatRuntime;
  provider: Provider;
  request: ChatRequest;
  keepBrowserOpen: boolean;
  sessionOptions?: { visible?: boolean; interactive?: boolean };
  output?: Output;
};

export async function executeChatWithContext(
  input: ContextualChatInput,
): Promise<ExecutionTranscript> {
  const transcript = await executeAndRelease(input);
  return recordFinalTranscript(input, transcript);
}

async function executeAndRelease(input: ContextualChatInput): Promise<ExecutionTranscript> {
  let context;
  try {
    context = input.runtime.contextFor(input.provider);
  } catch (error) {
    return failure(input, error);
  }
  let transcript: ExecutionTranscript;
  try {
    transcript = await executeChat({ ...input, context });
  } catch (error) {
    transcript = failure(input, error);
  }
  return releaseContext(input, context, transcript);
}

async function recordFinalTranscript(
  input: ContextualChatInput,
  transcript: ExecutionTranscript,
): Promise<ExecutionTranscript> {
  try {
    await input.runtime.recordChat?.(input.provider, transcript);
    return transcript;
  } catch (error) {
    return failure(input, error, transcript);
  }
}

async function releaseContext(
  input: ContextualChatInput,
  context: ReturnType<ChatRuntime['contextFor']>,
  transcript: ExecutionTranscript,
): Promise<ExecutionTranscript> {
  try {
    await input.runtime.releaseContext?.(context);
    return transcript;
  } catch (error) {
    return failure(input, error, transcript);
  }
}

function failure(
  input: ContextualChatInput,
  error: unknown,
  partial?: ExecutionTranscript,
): ExecutionTranscript {
  return createFailureTranscript({
    provider: input.provider,
    options: input.request,
    activity: partial?.activity ?? [],
    error,
    response: partial?.response,
  });
}
