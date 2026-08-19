export const supportedProviders = ['gemini'] as const;
export type Provider = (typeof supportedProviders)[number];
export const defaultProvider = supportedProviders[0];
