import { resolveConfig } from './config.js';
import { supportedProviders } from './supported-providers.js';

export function resolveProvider(provider: string | undefined): string {
  const resolvedProvider = provider ?? resolveConfig().defaultProvider;
  if (!isValidProvider(resolvedProvider)) {
    throw new Error(unsupportedProviderMessage(resolvedProvider));
  }
  return resolvedProvider;
}

export function isValidProvider(provider: string): boolean {
  return supportedProviders.includes(provider as (typeof supportedProviders)[number]);
}

function unsupportedProviderMessage(provider: string): string {
  return `Unsupported provider "${provider}". Supported providers: ${supportedProviders.join(', ')}.`;
}
