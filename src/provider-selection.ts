import { readCurrentConfig } from './config.js';

const supportedProvider = 'gemini';

export function selectedProvider(override: string | undefined): string {
  if (override) return validatedProvider(override);
  const provider = readCurrentConfig().defaultProvider;
  if (!provider) throw new Error(noProviderMessage());
  return validatedProvider(provider);
}

export function validatedProvider(provider: string): string {
  if (provider !== supportedProvider) {
    throw new Error(
      `Unsupported provider "${provider}". Supported providers: ${supportedProvider}.`,
    );
  }
  return provider;
}

function noProviderMessage(): string {
  return 'No provider selected. Set a default with "llmchat config set-default-provider gemini" or pass "--provider gemini".';
}
