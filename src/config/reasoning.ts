export type ReasoningMode = { name: string; uiValue: string };
export type ModelReasoning = { defaultMode: ReasoningMode; modes: readonly ReasoningMode[] };

const low = { name: 'Low', uiValue: 'Low' } as const;
const medium = { name: 'Medium', uiValue: 'Medium' } as const;
const high = { name: 'High', uiValue: 'High' } as const;
const geminiModes = Object.freeze([low, medium, high]);

const geminiModels: Record<string, ModelReasoning> = Object.freeze({
  '3.5 Flash-Lite': { defaultMode: low, modes: geminiModes },
  '3.8 Flash': { defaultMode: low, modes: geminiModes },
  '3.1 Pro': { defaultMode: low, modes: geminiModes },
  '4 Argon': { defaultMode: low, modes: geminiModes },
});

const geminiFallback: ModelReasoning = Object.freeze({ defaultMode: low, modes: geminiModes });

const legacyReasoning: Record<string, string> = {
  Standard: 'Low',
  'Extended thinking': 'High',
};

export function resolveGeminiReasoning(model: string | undefined): ModelReasoning {
  return (model && geminiModels[model]) || geminiFallback;
}

export function requestedReasoning(
  definition: ModelReasoning,
  value: string | undefined,
): ReasoningMode | undefined {
  if (value === undefined) return definition.defaultMode;
  const requested = legacyReasoning[value] ?? value;
  return definition.modes.find((mode) => mode.name === requested);
}
