#!/usr/bin/env node
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SUPPORTED_PROVIDER = 'gemini';
type Config = { defaultProvider?: string };

function configPath(): string {
  const root =
    process.env.XDG_CONFIG_HOME ?? process.env.LOCALAPPDATA ?? join(homedir(), '.config');
  return join(root, 'llmchat', 'config.json');
}

function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Unable to read llmchat configuration.');
  }
}

function validateProvider(provider: string): void {
  if (provider !== SUPPORTED_PROVIDER) {
    throw new Error(
      `Unsupported provider "${provider}". Supported providers: ${SUPPORTED_PROVIDER}.`,
    );
  }
}

function printRootHelp(): void {
  console.log(`Usage:
  llmchat chat "<prompt>" [--provider <provider>]
  llmchat config <set-default-provider|clear-default-provider> [provider]

Supported providers: gemini

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

function parseChat(args: string[]): { prompt?: string; provider?: string; help: boolean } {
  let provider: string | undefined;
  const promptParts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--help' || args[i] === '-h') return { help: true };
    if (args[i] === '--provider') {
      provider = args[++i];
      if (!provider) throw new Error('--provider requires a value.');
    } else if (args[i].startsWith('--')) {
      throw new Error(`Unknown option "${args[i]}".`);
    } else promptParts.push(args[i]);
  }
  return { prompt: promptParts.join(' ').trim() || undefined, provider, help: false };
}

function setDefaultProvider(provider: string): void {
  validateProvider(provider);
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ defaultProvider: provider }, null, 2)}\n`, 'utf8');
}

function clearDefaultProvider(): void {
  try {
    unlinkSync(configPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Unable to clear llmchat configuration.');
  }
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return printRootHelp();
  if (command === 'config') {
    if (!args.length || args[0] === '--help' || args[0] === '-h') return printConfigHelp();
    if (args[0] === 'set-default-provider' && args.length === 2) return setDefaultProvider(args[1]);
    if (args[0] === 'clear-default-provider' && args.length === 1) return clearDefaultProvider();
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  }
  if (command !== 'chat')
    throw new Error(`Unknown command "${command}". Use "llmchat --help" for usage.`);
  const parsed = parseChat(args);
  if (parsed.help) return printRootHelp();
  if (!parsed.prompt) throw new Error('A prompt is required.');
  const provider = parsed.provider ?? readConfig().defaultProvider;
  if (!provider)
    throw new Error(
      'No provider selected. Set a default with "llmchat config set-default-provider gemini" or pass "--provider gemini".',
    );
  validateProvider(provider);
  console.log(`Simulated response from ${provider}: ${parsed.prompt}`);
}

try {
  main();
} catch (error) {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
