export const supportedProviders = ['gemini', 'demo'] as const;
export type Provider = (typeof supportedProviders)[number];
export const defaultProvider: Provider = 'gemini';
