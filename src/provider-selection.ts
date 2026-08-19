import { readCurrentConfig } from './config.js';

const supportedProvider = 'gemini';

export function resolveProvider(explicit: string | undefined): string {
  const provider = explicit ?? readCurrentConfig().defaultProvider;
  if (!provider) throw new Error(noProviderMessage());
  if (!isValidProvider(provider)) throw new Error(unsupportedProviderMessage(provider));
  return provider;
}

export function isValidProvider(provider: string): boolean {
  return provider === supportedProvider;
}

function unsupportedProviderMessage(provider: string): string {
  return `Unsupported provider "${provider}". Supported providers: ${supportedProvider}.`;
}

function noProviderMessage(): string {
  return 'No provider selected. Set a default with "llmchat config set-default-provider gemini" or pass "--provider gemini".';
}
