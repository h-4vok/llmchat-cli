export const reasoningValues = Object.freeze({
  standard: 'Standard',
  extended: 'Extended thinking',
});

export function geminiReasoning(value: string | undefined): 'standard' | 'extended' | undefined {
  if (value === undefined || value === reasoningValues.standard) return 'standard';
  if (value === reasoningValues.extended) return 'extended';
  return undefined;
}
