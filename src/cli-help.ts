import type { Output } from './output.js';

export function printRootHelp(output: Output): void {
  output.emit({
    speaker: 'llmchat',
    message: `Usage:
  llmchat chat "<prompt>" [--provider <provider>] [--model <visible name>] [--reasoning <value>] [--keep-browser-open] [--gem|--gpt|--system-instructions <name>]
  llmchat auth <provider>
  llmchat health <provider>
  llmchat config <set-default-provider|clear-default-provider> [provider]

Supported providers: gemini

System instructions: --gem, --gpt, and --system-instructions are equivalent aliases.
Reasoning values for Gemini: "Standard", "Extended thinking". Default: "Standard".

Examples:
  llmchat chat "hello" --provider gemini
  llmchat auth gemini
  llmchat health gemini
  llmchat config set-default-provider gemini
  llmchat config clear-default-provider`,
  });
}

export function printConfigHelp(output: Output): void {
  output.emit({
    speaker: 'llmchat',
    message: `Usage:
  llmchat config set-default-provider <provider>
  llmchat config clear-default-provider

Supported providers: gemini

Examples:
  llmchat config set-default-provider gemini
  llmchat config clear-default-provider`,
  });
}
