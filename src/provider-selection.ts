import { resolveConfig } from './config.js';
import { supportedProviders, type Provider } from './supported-providers.js';

export function resolveProvider(provider: string | undefined): Provider {
  const resolvedProvider = provider ?? resolveConfig().defaultProvider;
  if (!isValidProvider(resolvedProvider)) {
    throw new Error(unsupportedProviderMessage(resolvedProvider));
  }
  return resolvedProvider;
}

export function isValidProvider(provider: string): provider is Provider {
  return supportedProviders.includes(provider as Provider);
}

function unsupportedProviderMessage(provider: string): string {
  return `Unsupported provider "${provider}". Supported providers: ${supportedProviders.join(', ')}.`;
}
