import { stringify } from 'yaml';
import type { OutputFormat } from './cli-args.js';
import type { Output } from './output.js';

const formats = new Set(['text', 'json', 'jsonl', 'yaml']);
const structuredRenderers = {
  json: (record: Record<string, unknown>) => `${JSON.stringify(record, null, 2)}\n`,
  jsonl: (record: Record<string, unknown>) => `${JSON.stringify(record)}\n`,
  yaml: (record: Record<string, unknown>) => stringify(record),
};

export function writeCliRecord(
  output: Output,
  record: Record<string, unknown>,
  format: OutputFormat,
): void {
  if (format === 'text') return;
  if (!output.raw) throw new Error('Structured output requires a raw output writer.');
  output.raw(structuredRenderers[format](record));
}

export function commandOutput(args: string[], output: Output): Output {
  if (requestedFormat(args) === 'text' || !output.raw) return output;
  return { emit() {}, raw: output.raw };
}

export function emitCliFailure(args: string[], output: Output, message: string): void {
  const format = requestedFormat(args);
  if (format === 'text' || !output.raw) {
    output.emit({ speaker: 'llmchat', tone: 'error', message });
    return;
  }
  writeCliRecord(
    output,
    {
      schemaVersion: 1,
      type: 'result',
      command: args[0],
      status: 'failure',
      error: { code: 'CLI_FAILED', message },
    },
    format,
  );
}

function requestedFormat(args: string[]): OutputFormat {
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  const index = options.indexOf('--output');
  if (index < 0) return 'text';
  const value = options[index + 1];
  return formats.has(value) ? (value as OutputFormat) : 'text';
}
