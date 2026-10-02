const familyPatterns: Record<string, string> = {
  flash: 'Flash',
  'flash lite': 'Flash[-\\s]+Lite',
};

export function geminiModelNamePattern(requested: string): RegExp {
  const name = requested.trim().replace(/\s+/g, ' ');
  const family = familyPatterns[name.toLowerCase().replace(/-/g, ' ')];
  const pattern = family
    ? `(?:Gemini\\s+)?(?:\\d+(?:\\.\\d+)*\\s+)?${family}`
    : literalPattern(name);
  return new RegExp(`^\\s*${pattern}\\s*$`, 'i');
}

export function isSelectedGeminiModel(requested: string, selected: string): boolean {
  return geminiModelNamePattern(requested).test(selected.trim().replace(/\s+Extended$/i, ''));
}

function literalPattern(name: string): string {
  return name
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/Flash[ -]+Lite$/i, 'Flash[-\\s]+Lite');
}
