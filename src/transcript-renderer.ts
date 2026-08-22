import { stringify as stringifyYaml } from 'yaml';
import type { OutputFormat } from './cli-args.js';
import type { ExecutionTranscript } from './execution-transcript.js';
import { transcriptSchemaVersion } from './execution-transcript.js';

const renderers: Record<OutputFormat, (transcript: ExecutionTranscript) => string> = {
  text: renderText,
  json: (transcript) => `${JSON.stringify(transcript, null, 2)}\n`,
  jsonl: renderJsonLines,
  yaml: stringifyYaml,
};

export function renderTranscript(transcript: ExecutionTranscript, format: OutputFormat): string {
  return renderers[format](transcript);
}

function renderText(transcript: ExecutionTranscript): string {
  const activity = transcript.activity.map((event) => event.message);
  const terminal =
    transcript.status === 'success' ? transcript.response.text : transcript.error.message;
  return [...activity, terminal].join('\n') + '\n';
}

function renderJsonLines(transcript: ExecutionTranscript): string {
  const activity = transcript.activity.map((event) => ({
    schemaVersion: transcriptSchemaVersion,
    type: 'activity',
    provider: transcript.provider,
    ...event,
  }));
  return (
    [...activity, terminalRecord(transcript)].map((record) => JSON.stringify(record)).join('\n') +
    '\n'
  );
}

function terminalRecord(transcript: ExecutionTranscript): Record<string, unknown> {
  const terminal = {
    schemaVersion: transcript.schemaVersion,
    provider: transcript.provider,
    options: transcript.options,
    status: transcript.status,
  };
  if (transcript.status === 'success')
    return { ...terminal, type: 'result', response: transcript.response };
  return {
    ...terminal,
    type: 'result',
    error: transcript.error,
    ...optionalResponse(transcript.response),
  };
}

function optionalResponse(response: { text: string } | undefined) {
  return response ? { response } : {};
}
