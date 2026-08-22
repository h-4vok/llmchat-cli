import { executeChatWithContext } from './chat-execution.js';
import type { ChatRuntime } from './chat-runtime.js';
import { parseChat } from './cli-args.js';
import { printRootHelp } from './cli-help.js';
import type { ExecutionTranscript } from './execution-transcript.js';
import type { Output } from './output.js';
import { resolveProvider } from './provider-selection.js';
import { renderTranscript } from './transcript-renderer.js';

export async function runChatCommand(
  args: string[],
  output: Output,
  runtime: ChatRuntime,
): Promise<0 | 1> {
  const parsed = parseChat(args);
  if (parsed.help) return showHelp(output);
  if (!parsed.prompt) throw new Error('A prompt is required.');
  const provider = resolveProvider(parsed.provider);
  const transcript = await executeWithContext(runtime, provider, parsed, output);
  renderChatResult(output, transcript, parsed.output);
  return transcript.status === 'success' ? 0 : 1;
}

async function executeWithContext(
  runtime: ChatRuntime,
  provider: ReturnType<typeof resolveProvider>,
  parsed: ReturnType<typeof parseChat>,
  output: Output,
): Promise<ExecutionTranscript> {
  const request = chatRequest(parsed);
  return executeChatWithContext({
    runtime,
    provider,
    request,
    keepBrowserOpen: Boolean(parsed.keepBrowserOpen),
    output: textOutput(parsed.output, output),
  });
}

function showHelp(output: Output): 0 {
  printRootHelp(output);
  return 0;
}

function textOutput(format: ReturnType<typeof parseChat>['output'], output: Output) {
  return format === 'text' ? output : undefined;
}

function renderChatResult(
  output: Output,
  transcript: ExecutionTranscript,
  format: ReturnType<typeof parseChat>['output'],
): void {
  if (format !== 'text') return writeStructured(output, renderTranscript(transcript, format));
  if (transcript.status === 'failure') {
    output.emit({ speaker: 'llmchat', tone: 'error', message: transcript.error.message });
  }
}

function writeStructured(output: Output, payload: string): void {
  if (!output.raw) throw new Error('Structured output requires a raw output writer.');
  output.raw(payload);
}

function chatRequest(parsed: ReturnType<typeof parseChat>) {
  return {
    model: parsed.model,
    prompt: parsed.prompt as string,
    systemInstructions: parsed.systemInstructions,
    ...(parsed.reasoning === undefined ? {} : { reasoning: parsed.reasoning }),
    keepBrowserOpen: parsed.keepBrowserOpen,
    disposableConversation: parsed.disposableConversation,
  };
}
