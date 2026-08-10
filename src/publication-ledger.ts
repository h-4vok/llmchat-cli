import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { Envelope, envelopeHash, marker } from './agent-output.js';

export type LedgerEntry = {
  key: string;
  envelope: Envelope;
  envelope_hash: string;
  action: string;
  placement: string;
  status: 'pending' | 'published' | 'fallback' | 'resolved' | 'failed';
  marker: string;
  remote_id?: string;
  url?: string;
  fallback_reason?: string;
};
export type PublicationState = {
  envelopes: Record<string, Envelope>;
  human_feedback: Record<string, unknown>;
  publications: Record<string, LedgerEntry>;
};
export function loadPublicationState(file: string): PublicationState {
  if (!existsSync(file)) return { envelopes: {}, human_feedback: {}, publications: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function savePublicationState(file: string, state: PublicationState): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, file);
}
export function recordEnvelope(state: PublicationState, envelope: Envelope): void {
  state.envelopes[envelope.message_id] = envelope;
}
export function pendingPublication(
  state: PublicationState,
  key: string,
  envelope: Envelope,
  action: string,
  placement: string,
): LedgerEntry {
  const existing = state.publications[key];
  if (existing) return existing;
  const entry: LedgerEntry = {
    key,
    envelope,
    envelope_hash: envelopeHash(envelope),
    action,
    placement,
    status: 'pending',
    marker: marker(key),
  };
  state.publications[key] = entry;
  return entry;
}
