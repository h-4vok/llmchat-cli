export type ReasoningMode = { name: string; uiValue: string; extended: boolean };
export type ModelReasoning = { defaultMode: ReasoningMode; modes: readonly ReasoningMode[] };

const standard = { name: 'Standard', uiValue: 'Standard', extended: false } as const;
const extended = {
  name: 'Extended thinking',
  uiValue: 'Extended thinking',
  extended: true,
} as const;
const geminiModes = Object.freeze([standard, extended]);

const geminiModels: Record<string, ModelReasoning> = Object.freeze({
  '3.5 Flash-Lite': { defaultMode: standard, modes: geminiModes },
  '3.6 Flash': { defaultMode: standard, modes: geminiModes },
  '3.1 Pro': { defaultMode: standard, modes: geminiModes },
});

const geminiFallback: ModelReasoning = Object.freeze({ defaultMode: standard, modes: geminiModes });

export function resolveGeminiReasoning(model: string | undefined): ModelReasoning {
  return (model && geminiModels[model]) || geminiFallback;
}

export function requestedReasoning(
  definition: ModelReasoning,
  value: string | undefined,
): ReasoningMode | undefined {
  if (value === undefined) return definition.defaultMode;
  return definition.modes.find((mode) => mode.name === value);
}
