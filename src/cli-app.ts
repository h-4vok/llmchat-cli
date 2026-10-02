import type { ChatRuntime } from './chat-runtime.js';
import { printRootHelp } from './cli-help.js';
import { errorMessage } from './error-format.js';
import type { Output } from './output.js';
import { redactSessionSecrets } from './secret-redaction.js';
import { runtimeConfig } from './config/runtime.js';
import { startMcpServer } from './mcp-command.js';
import { runChatCommand } from './cli-chat.js';
import { runAuth, runConfig, runHealth } from './admin-commands.js';
import { commandOutput, emitCliFailure } from './cli-process-output.js';

type CommandHandler = (
  args: string[],
  output: Output,
  runtime: ChatRuntime,
) => void | 0 | 1 | Promise<void | 0 | 1>;

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
    return await runCli(args, commandOutput(args, output), runtime);
  } catch (error) {
    emitCliFailure(args, output, redactSessionSecrets(errorMessage(error)));
    return runtimeConfig.exitCode.failure;
  }
}

function isRootHelp(command: string | undefined): boolean {
  return !command || command === '--help' || command === '-h';
}
