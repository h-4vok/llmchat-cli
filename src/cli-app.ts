import type { ChatRuntime } from './chat-runtime.js';
import { printConfigHelp, printRootHelp } from './cli-help.js';
import { removeDefaultProvider, saveDefaultProvider } from './config.js';
import { errorMessage } from './error-format.js';
import type { Output } from './output.js';
import { resolveProvider } from './provider-selection.js';
import { redactSessionSecrets } from './secret-redaction.js';
import { withRuntimeContext } from './runtime-context.js';
import { messages } from './config/messages.js';
import { runtimeConfig } from './config/runtime.js';
import type { BrowserSessionResult } from './browser-session.js';
import { startMcpServer } from './mcp-command.js';
import { runChatCommand } from './cli-chat.js';

type CommandHandler = (
  args: string[],
  output: Output,
  runtime: ChatRuntime,
) => void | 0 | 1 | Promise<void | 0 | 1>;
type ConfigHandler = (args: string[]) => void;

const commandHandlers: Record<string, CommandHandler> = {
  auth: runAuth,
  chat: runChatCommand,
  config: runConfig,
  health: runHealth,
  mcp: runMcp,
};

async function runMcp(args: string[], _output: Output, runtime: ChatRuntime): Promise<void> {
  if (args.length) throw new Error('Usage: llmchat mcp.');
  await startMcpServer(runtime);
}

export async function runCli(args: string[], output: Output, runtime: ChatRuntime): Promise<0 | 1> {
  const [command, ...commandArgs] = args;
  if (isRootHelp(command)) {
    printRootHelp(output);
    return 0;
  }
  const handler = commandHandlers[command];
  if (!handler) throw new Error(`Unknown command "${command}". Use "llmchat --help" for usage.`);
  return commandStatus(await handler(commandArgs, output, runtime));
}

function commandStatus(result: void | 0 | 1): 0 | 1 {
  return result ?? 0;
}

export async function runCliProcess(
  args: string[],
  output: Output,
  runtime: ChatRuntime,
): Promise<0 | 1> {
  try {
    return await runCli(args, output, runtime);
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
  saveDefaultProvider(resolveProvider(args[1]));
}

function clearDefaultProvider(args: string[]): void {
  if (args.length !== 1)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  removeDefaultProvider();
}

async function runAuth(args: string[], output: Output, runtime: ChatRuntime): Promise<void> {
  if (args.length !== 1) throw new Error('Usage: llmchat auth <provider>.');
  const provider = resolveProvider(args[0]);
  if (runtime.capabilitiesFor?.(provider).authentication === 'none') {
    output.emit({
      speaker: 'llmchat',
      message: `Provider ${provider} does not require authentication.`,
    });
    return;
  }
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
  const provider = resolveProvider(args[0]);
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
