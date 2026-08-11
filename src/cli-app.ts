import { parseChat } from './cli-args.js';
import { readCurrentConfig, removeDefaultProvider, saveDefaultProvider } from './config.js';
import { sendChat } from './provider.js';

const supportedProvider = 'gemini';
type CommandHandler = (args: string[]) => void;

const commandHandlers: Record<string, CommandHandler> = {
  chat: runChat,
  config: runConfig,
};

export function runCli(args: string[]): void {
  const [command, ...commandArgs] = args;
  if (isRootHelp(command)) return printRootHelp();
  const handler = commandHandlers[command];
  if (!handler) throw new Error(`Unknown command "${command}". Use "llmchat --help" for usage.`);
  handler(commandArgs);
}

function isRootHelp(command: string | undefined): boolean {
  return !command || command === '--help' || command === '-h';
}

function runConfig(args: string[]): void {
  if (isConfigHelp(args)) return printConfigHelp();
  const action = configActions[args[0]];
  if (!action) throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  action(args);
}

function isConfigHelp(args: string[]): boolean {
  return !args.length || args[0] === '--help' || args[0] === '-h';
}

const configActions: Record<string, CommandHandler> = {
  'clear-default-provider': clearDefaultProvider,
  'set-default-provider': setDefaultProvider,
};

function setDefaultProvider(args: string[]): void {
  if (args.length !== 2)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  validateProvider(args[1]);
  saveDefaultProvider(args[1]);
}

function clearDefaultProvider(args: string[]): void {
  if (args.length !== 1)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  removeDefaultProvider();
}

function runChat(args: string[]): void {
  const parsed = parseChat(args);
  if (parsed.help) return printRootHelp();
  if (!parsed.prompt) throw new Error('A prompt is required.');
  const provider = selectedProvider(parsed.provider);
  console.log(
    sendChat(provider, { prompt: parsed.prompt, systemInstructions: parsed.systemInstructions }),
  );
}

function selectedProvider(override: string | undefined): string {
  if (override) return validatedProvider(override);
  const provider = readCurrentConfig().defaultProvider;
  if (!provider) throw new Error(noProviderMessage());
  return validatedProvider(provider);
}

function validatedProvider(provider: string): string {
  validateProvider(provider);
  return provider;
}

function validateProvider(provider: string): void {
  if (provider !== supportedProvider) {
    throw new Error(
      `Unsupported provider "${provider}". Supported providers: ${supportedProvider}.`,
    );
  }
}

function noProviderMessage(): string {
  return 'No provider selected. Set a default with "llmchat config set-default-provider gemini" or pass "--provider gemini".';
}

function printRootHelp(): void {
  console.log(`Usage:
  llmchat chat "<prompt>" [--provider <provider>] [--gem|--gpt|--system-instructions <name>]
  llmchat config <set-default-provider|clear-default-provider> [provider]

Supported providers: gemini

System instructions: --gem, --gpt, and --system-instructions are equivalent aliases.

Examples:
  llmchat chat "hello" --provider gemini
  llmchat config set-default-provider gemini
  llmchat config clear-default-provider`);
}

function printConfigHelp(): void {
  console.log(`Usage:
  llmchat config set-default-provider <provider>
  llmchat config clear-default-provider

Supported providers: gemini

Examples:
  llmchat config set-default-provider gemini
  llmchat config clear-default-provider`);
}
