import type { Output } from './output.js';
import { supportedProviders } from './supported-providers.js';

export function printRootHelp(output: Output): void {
  output.emit({
    speaker: 'llmchat',
    message: `Usage:
  llmchat chat "<prompt>" [--provider <provider>] [--model <visible name>] [--reasoning <value>] [--output <text|json|jsonl|yaml>] [--keep-browser-open] [--disposable-conversation] [--gem|--gpt|--system-instructions <name>]
  llmchat auth <provider>
  llmchat health <provider>
  llmchat mcp
  llmchat config <set-default-provider|clear-default-provider> [provider]

Supported providers: ${supportedProviders.join(', ')}

System instructions: --gem, --gpt, and --system-instructions are equivalent aliases.
Reasoning values for Gemini: "Standard", "Extended thinking". Default: "Standard".

Examples:
  llmchat chat "hello" --provider gemini
  llmchat chat "hello" --provider demo
  llmchat chat "hello" --output json
  llmchat auth gemini
  llmchat health gemini
  llmchat mcp
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

Supported providers: ${supportedProviders.join(', ')}

Examples:
  llmchat config set-default-provider gemini
  llmchat config set-default-provider demo
  llmchat config clear-default-provider`,
  });
}
