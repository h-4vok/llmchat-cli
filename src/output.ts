export const palette = {
  blue: '\u001b[38;5;33m',
  terracotta: '\u001b[38;5;173m',
  emerald: '\u001b[38;5;35m',
  amber: '\u001b[38;5;214m',
  red: '\u001b[38;5;196m',
  reset: '\u001b[0m',
} as const;

export type Speaker = {
  label: string;
  color: string;
};

export type SpeakerRegistry = Readonly<Record<string, Speaker>>;
export type OutputTone = 'normal' | 'warning' | 'error';

export type OutputEvent = {
  speaker: string;
  message: string;
  tone?: OutputTone;
};

export type Output = {
  emit(event: OutputEvent): void;
};

export const speakers: SpeakerRegistry = {
  gemini: { label: 'GEMINI', color: palette.blue },
  chatgpt: { label: 'CHATGPT', color: palette.terracotta },
  llmchat: { label: 'LLMCHAT', color: palette.emerald },
  warning: { label: 'WARNING', color: palette.amber },
  error: { label: 'ERROR', color: palette.red },
};

export type OutputOptions = {
  write(line: string): void;
  now?: () => Date;
  speakers?: SpeakerRegistry;
};

const toneColors: Partial<Record<OutputTone, string>> = {
  warning: palette.amber,
  error: palette.red,
};

export function createOutput(options: OutputOptions): Output {
  const registry = options.speakers ?? speakers;
  const labelWidth = maximumLabelWidth(registry);
  const now = options.now ?? (() => new Date());
  return {
    emit(event): void {
      const speaker = selectedSpeaker(registry, event.speaker);
      const color = toneColors[event.tone ?? 'normal'] ?? speaker.color;
      const prefix = `${speaker.label.padEnd(labelWidth)} ## [${timestamp(now())}]`;
      for (const line of event.message.split(/\r?\n/)) {
        options.write(`${color}${prefix} ${line}${palette.reset}`);
      }
    },
  };
}

function selectedSpeaker(registry: SpeakerRegistry, name: string): Speaker {
  const speaker = registry[name];
  if (!speaker) throw new Error(`Unknown output speaker "${name}".`);
  return speaker;
}

function maximumLabelWidth(registry: SpeakerRegistry): number {
  return Math.max(...Object.values(registry).map(({ label }) => label.length));
}

function timestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
