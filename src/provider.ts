export type ChatRequest = {
  prompt: string;
  systemInstructions?: string;
  reasoning?: string;
};

function resolveSystemInstructions(provider: string, name: string): string {
  // The simulation models a provider lookup failure without pretending to
  // know or persist the provider's remote configurations.
  if (/^(missing|not[- ]found|unresolvable)$/i.test(name)) {
    throw new Error(`Provider ${provider} could not resolve system instructions "${name}".`);
  }
  return name;
}

export function sendChat(provider: string, request: ChatRequest): string {
  const resolvedSystemInstructions = request.systemInstructions
    ? resolveSystemInstructions(provider, request.systemInstructions)
    : undefined;
  const instructions = resolvedSystemInstructions
    ? ` using system instructions ${JSON.stringify(resolvedSystemInstructions)}`
    : '';
  const reasoning = request.reasoning
    ? ` using reasoning ${JSON.stringify(request.reasoning)}`
    : '';
  return `Simulated response from ${provider}${instructions}${reasoning}: ${request.prompt}`;
}
