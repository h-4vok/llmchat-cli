import { executeWithTimeout, type ChatRequest, type ChatResponse } from './adapter-contract.js';
import type { ChatRuntime } from './chat-runtime.js';
import type { AdapterContext } from './adapter-contract.js';
import type { Output } from './output.js';
import { messages } from './config/messages.js';

export type ChatCommandInput = {
  runtime: ChatRuntime;
  provider: string;
  context: AdapterContext;
  request: ChatRequest;
  keepBrowserOpen: boolean;
  output: Output;
};

export async function executeChat({
  runtime,
  provider,
  context,
  request,
  keepBrowserOpen,
  output,
}: ChatCommandInput): Promise<void> {
  const unsubscribe = subscribeToActivity(context, output);
  try {
    const session = prepareSession(runtime, provider, context);
    if (session) await session;
    const response = await executeWithTimeout(
      runtime.adapterFor(provider),
      request,
      context,
      runtime.timeout,
    );
    output.emit({ speaker: provider, message: response.text });
    await waitForBrowser(response, keepBrowserOpen);
  } finally {
    unsubscribe();
  }
}

function subscribeToActivity(context: AdapterContext, output: Output): () => void {
  return (
    context.onActivity?.((event) => output.emit({ speaker: 'llmchat', message: event.message })) ??
    (() => {})
  );
}

function prepareSession(
  runtime: ChatRuntime,
  provider: string,
  context: AdapterContext,
): Promise<void> | undefined {
  const session = runtime.ensureSession?.(provider, context);
  return session?.then((result) => validateSession(result, provider));
}

function validateSession(result: { status: string }, provider: string): void {
  if (result.status === 'indeterminate') throw new Error(messages.geminiLoginRequired);
  if (result.status === 'cancelled') throw new Error(`${provider} authentication was cancelled.`);
}

async function waitForBrowser(response: ChatResponse, keepBrowserOpen: boolean): Promise<void> {
  if (keepBrowserOpen) await response.waitForClose?.();
}
