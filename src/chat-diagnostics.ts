import type { ExecutionTranscript } from './execution-transcript.js';
import { appendDiagnosticLog, type StorageOptions } from './secure-storage.js';

export function persistTranscriptDiagnostic(
  provider: string,
  transcript: ExecutionTranscript,
  options?: StorageOptions,
): void {
  appendDiagnosticLog(
    provider,
    {
      message: `chat ${transcript.status}`,
      prompt: transcript.options.prompt,
      response: transcript.response?.text ?? '',
    },
    options,
  );
}
