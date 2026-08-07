export type ChatRequest = {
  prompt: string;
  systemInstructions?: string;
};

export function sendChat(provider: string, request: ChatRequest): string {
  const instructions = request.systemInstructions
    ? ` using system instructions ${JSON.stringify(request.systemInstructions)}`
    : '';
  return `Simulated response from ${provider}${instructions}: ${request.prompt}`;
}
