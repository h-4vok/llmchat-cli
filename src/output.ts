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

export const speakers = {
  gemini: { label: 'GEMINI', color: palette.blue },
  demo: { label: 'DEMO', color: palette.amber },
  chatgpt: { label: 'CHATGPT', color: palette.terracotta },
  llmchat: { label: 'LLMCHAT', color: palette.emerald },
  warning: { label: 'WARNING', color: palette.amber },
  error: { label: 'ERROR', color: palette.red },
} satisfies Record<string, Speaker>;

export type SpeakerName = keyof typeof speakers;
export type SpeakerRegistry = Readonly<Record<SpeakerName, Speaker>>;
export type OutputTone = 'warning' | 'error';

export type OutputEvent = {
  speaker: SpeakerName;
  message: string;
  tone?: OutputTone;
};

export type Output = {
  emit(event: OutputEvent): void;
  raw?(payload: string): void;
};

export type OutputOptions = {
  write(line: string): void;
  now?: () => Date;
};

const toneColors: Record<OutputTone, string> = {
  warning: palette.amber,
  error: palette.red,
};

export function createOutput(options: OutputOptions): Output {
  const labelWidth = maximumLabelWidth(speakers);
  const now = options.now ?? (() => new Date());
  return {
    emit(event): void {
      const formattedLines = formatOutputEvent(event, now(), labelWidth);
      formattedLines.forEach(options.write);
    },
    raw(payload): void {
      payload.replace(/\n$/, '').split('\n').forEach(options.write);
    },
  };
}

function formatOutputEvent(event: OutputEvent, date: Date, labelWidth: number): string[] {
  const speaker = speakers[event.speaker];
  const resolvedColor = toneColors[event.tone!] ?? speaker.color;
  const formattedPrefix = `${speaker.label.padEnd(labelWidth)} ## [${timestamp(date)}]`;
  return event.message
    .split(/\r?\n/)
    .map((line) => `${resolvedColor}${formattedPrefix} ${line}${palette.reset}`);
}

function maximumLabelWidth(registry: SpeakerRegistry): number {
  return Math.max(...Object.values(registry).map(({ label }) => label.length));
}

function timestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
