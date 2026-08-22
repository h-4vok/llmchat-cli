import { executeWithTimeout, type AdapterContext, type ChatRequest } from './adapter-contract.js';
import type { ChatRuntime } from './chat-runtime.js';
import {
  createFailureTranscript,
  transcriptSchemaVersion,
  type ExecutionTranscript,
} from './execution-transcript.js';
import type { Output } from './output.js';
import type { Provider } from './supported-providers.js';
import { messages } from './config/messages.js';

export type ChatCommandInput = {
  runtime: ChatRuntime;
  provider: Provider;
  context: AdapterContext;
  request: ChatRequest;
  keepBrowserOpen: boolean;
  sessionOptions?: { visible?: boolean; interactive?: boolean };
  output?: Output;
};

type ExecutionProgress = {
  activity: ExecutionTranscript['activity'];
  responseText?: string;
};

export async function executeChat(input: ChatCommandInput): Promise<ExecutionTranscript> {
  const progress: ExecutionProgress = { activity: [] };
  const unsubscribe = subscribeToActivity(input.context, progress.activity, input.output);
  let transcript: ExecutionTranscript;
  try {
    transcript = await executeSuccessfulChat(input, progress);
  } catch (error) {
    transcript = createFailure(input, progress, error);
  } finally {
    unsubscribe();
  }
  return transcript;
}

async function executeSuccessfulChat(
  input: ChatCommandInput,
  progress: ExecutionProgress,
): Promise<ExecutionTranscript> {
  const response = await executeAfterSession(input);
  progress.responseText = response.text;
  emitResponse(input.output, input.provider, response.text);
  await waitForBrowser(response.waitForClose, input.keepBrowserOpen);
  return {
    schemaVersion: transcriptSchemaVersion,
    provider: input.provider,
    options: input.request,
    activity: progress.activity,
    status: 'success',
    response: { text: response.text },
  };
}

function executeAfterSession(input: ChatCommandInput) {
  const execute = () =>
    executeWithTimeout(
      input.runtime.adapterFor(input.provider),
      input.request,
      input.context,
      input.runtime.timeout,
    );
  const session = prepareSession(
    input.runtime,
    input.provider,
    input.context,
    input.sessionOptions,
  );
  return session ? session.then(execute) : execute();
}

function emitResponse(output: Output | undefined, provider: Provider, message: string): void {
  output?.emit({ speaker: provider, message });
}

async function waitForBrowser(wait: (() => Promise<void>) | undefined, keepOpen: boolean) {
  if (keepOpen) await wait?.();
}

function createFailure(
  input: ChatCommandInput,
  progress: ExecutionProgress,
  error: unknown,
): ExecutionTranscript {
  return createFailureTranscript({
    provider: input.provider,
    options: input.request,
    activity: progress.activity,
    error,
    ...optionalResponse(progress.responseText),
  });
}

function optionalResponse(text: string | undefined): { response?: { text: string } } {
  return text === undefined ? {} : { response: { text } };
}

function subscribeToActivity(
  context: AdapterContext,
  activity: ExecutionTranscript['activity'],
  output?: Output,
): () => void {
  return (
    context.onActivity?.((event) => {
      activity.push(event);
      output?.emit({ speaker: 'llmchat', message: event.message });
    }) ?? (() => {})
  );
}

function prepareSession(
  runtime: ChatRuntime,
  provider: Provider,
  context: AdapterContext,
  options?: { visible?: boolean; interactive?: boolean },
): Promise<void> | undefined {
  if (runtime.capabilitiesFor?.(provider).browserSession === false) return undefined;
  return runtime
    .ensureSession?.(provider, context, options)
    .then((result) => validateSession(result, provider));
}

function validateSession(result: { status: string }, provider: Provider): void {
  if (result.status === 'authentication-required')
    throw new Error(
      `Provider ${provider} requires authentication. Run "llmchat auth ${provider}" in a local terminal.`,
    );
  if (result.status === 'indeterminate') throw new Error(messages.geminiLoginRequired);
  if (result.status === 'cancelled') throw new Error(`${provider} authentication was cancelled.`);
}
