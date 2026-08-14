import { defaultChatRuntime, type ChatRuntime } from './chat-runtime.js';
import { executeChat } from './chat-command.js';
import { parseChat } from './cli-args.js';
import { printConfigHelp, printRootHelp } from './cli-help.js';
import { removeDefaultProvider, saveDefaultProvider } from './config.js';
import { errorMessage } from './error-format.js';
import type { Output } from './output.js';
import { selectedProvider, validatedProvider } from './provider-selection.js';
import { redactSessionSecrets } from './secret-redaction.js';
import { withRuntimeContext } from './runtime-context.js';
import { messages } from './config/messages.js';
import { runtimeConfig } from './config/runtime.js';
import type { BrowserSessionResult } from './browser-session.js';

type CommandHandler = (
  args: string[],
  output: Output,
  runtime: ChatRuntime,
) => void | Promise<void>;
type ConfigHandler = (args: string[]) => void;

const commandHandlers: Record<string, CommandHandler> = {
  auth: runAuth,
  chat: runChat,
  config: runConfig,
  health: runHealth,
};

export async function runCli(
  args: string[],
  output: Output,
  runtime: ChatRuntime = defaultChatRuntime,
): Promise<void> {
  const [command, ...commandArgs] = args;
  if (isRootHelp(command)) return void printRootHelp(output);
  const handler = commandHandlers[command];
  if (!handler) throw new Error(`Unknown command "${command}". Use "llmchat --help" for usage.`);
  await handler(commandArgs, output, runtime);
}

export async function runCliProcess(
  args: string[],
  output: Output,
  runtime: ChatRuntime = defaultChatRuntime,
): Promise<0 | 1> {
  try {
    await runCli(args, output, runtime);
    return runtimeConfig.exitCode.success;
  } catch (error) {
    output.emit({
      speaker: 'llmchat',
      tone: 'error',
      message: redactSessionSecrets(errorMessage(error)),
    });
    return runtimeConfig.exitCode.failure;
  }
}

function isRootHelp(command: string | undefined): boolean {
  return !command || command === '--help' || command === '-h';
}

function runConfig(args: string[], output: Output): void {
  if (isConfigHelp(args)) return printConfigHelp(output);
  const action = configActions[args[0]];
  if (!action) throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  action(args);
}

function isConfigHelp(args: string[]): boolean {
  return !args.length || args[0] === '--help' || args[0] === '-h';
}

const configActions: Record<string, ConfigHandler> = {
  'clear-default-provider': clearDefaultProvider,
  'set-default-provider': setDefaultProvider,
};

function setDefaultProvider(args: string[]): void {
  if (args.length !== 2)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  saveDefaultProvider(validatedProvider(args[1]));
}

function clearDefaultProvider(args: string[]): void {
  if (args.length !== 1)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  removeDefaultProvider();
}

async function runChat(args: string[], output: Output, runtime: ChatRuntime): Promise<void> {
  const parsed = parseChat(args);
  if (parsed.help) return printRootHelp(output);
  if (!parsed.prompt) throw new Error('A prompt is required.');
  const provider = selectedProvider(parsed.provider);
  const request = chatRequest(parsed);
  await withRuntimeContext(runtime, provider, async (context) => {
    await executeChat(runtime, provider, context, request, parsed.keepBrowserOpen ?? false, output);
  });
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

async function runAuth(args: string[], output: Output, runtime: ChatRuntime): Promise<void> {
  if (args.length !== 1) throw new Error('Usage: llmchat auth <provider>.');
  const provider = validatedProvider(args[0]);
  await withRuntimeContext(runtime, provider, async (context) => {
    const session = requireSession(runtime, provider, context, { visible: true });
    const result = session ? await session : undefined;
    emitAuthSuccess(output, result);
  });
}

function emitAuthSuccess(output: Output, result: BrowserSessionResult | undefined): void {
  if (result?.status !== 'ready') return;
  const message =
    result.source === 'reused' ? messages.auth.sessionReused : messages.auth.sessionAuthenticated;
  output.emit({ speaker: 'llmchat', message });
}

async function runHealth(args: string[], output: Output, runtime: ChatRuntime): Promise<void> {
  if (args.length !== 1) throw new Error('Usage: llmchat health <provider>.');
  const provider = validatedProvider(args[0]);
  await withRuntimeContext(runtime, provider, async (context) => {
    const health = await runtime.adapterFor(provider).checkHealth(context);
    if (health.status === 'broken') throw new Error(health.message);
    output.emit({ speaker: 'llmchat', message: health.message });
  });
}

function requireSession(
  runtime: ChatRuntime,
  provider: string,
  context: ReturnType<ChatRuntime['contextFor']>,
  options?: { visible?: boolean },
): Promise<BrowserSessionResult> | undefined {
  return runtime.ensureSession?.(provider, context, options).then((result) => {
    if (result.status === 'indeterminate') throw new Error(messages.geminiLoginRequired);
    if (result.status === 'cancelled') throw new Error(`${provider} authentication was cancelled.`);
    return result;
  });
}
