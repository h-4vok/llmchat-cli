import type { AdapterNotification, ChatRequest } from './adapter-contract.js';
import { errorMessage } from './error-format.js';
import { redactSessionSecrets } from './secret-redaction.js';

export const transcriptSchemaVersion = 1;

export type PublicChatError = {
  code: 'CHAT_FAILED';
  message: string;
};

type TranscriptBase = {
  schemaVersion: 1;
  provider: string;
  options: ChatRequest;
  activity: AdapterNotification[];
};

export type SuccessfulTranscript = TranscriptBase & {
  status: 'success';
  response: { text: string };
};

export type FailedTranscript = TranscriptBase & {
  status: 'failure';
  error: PublicChatError;
  response?: { text: string };
};

export type ExecutionTranscript = SuccessfulTranscript | FailedTranscript;

type FailureInput = {
  provider: string;
  options: ChatRequest;
  activity: AdapterNotification[];
  error: unknown;
  response?: { text: string };
};

export function createFailureTranscript(input: FailureInput): FailedTranscript {
  return {
    schemaVersion: transcriptSchemaVersion,
    provider: input.provider,
    options: input.options,
    activity: input.activity,
    status: 'failure',
    error: { code: 'CHAT_FAILED', message: redactSessionSecrets(errorMessage(input.error)) },
    ...(input.response ? { response: input.response } : {}),
  };
}
