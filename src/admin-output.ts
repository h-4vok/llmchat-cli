import type { OutputFormat } from './cli-args.js';
import type { Output } from './output.js';

export type AdminOutput = {
  schemaVersion: 1;
  type: 'result';
  command: string;
  status: 'success' | 'failure';
  data?: Record<string, unknown>;
  error?: { code: 'CLI_FAILED'; message: string };
};

export function emitAdmin(
  output: Output,
  command: string,
  data: Record<string, unknown>,
  format: OutputFormat,
): void {
  if (format === 'text') return;
  if (!output.raw) throw new Error('Structured output requires a raw output writer.');
  const record: AdminOutput = {
    schemaVersion: 1,
    type: 'result',
    command,
    status: 'success',
    data,
  };
  output.raw(`${JSON.stringify(record)}\n`);
}

export function adminFormat(args: string[]): { args: string[]; format: OutputFormat } {
  const index = args.indexOf('--output');
  if (index < 0) return { args, format: 'text' };
  const value = args[index + 1];
  if (!['jsonl', 'json', 'yaml', 'text'].includes(value))
    throw new Error(`Unsupported output format "${value}".`);
  return {
    args: args.filter((_arg, position) => position !== index && position !== index + 1),
    format: value as OutputFormat,
  };
}
