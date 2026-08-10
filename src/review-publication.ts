import { createHash } from 'node:crypto';
import { marker, Placement, ReviewArtifact, artifactKey } from './agent-output.js';

export type DiffLine = { path: string; side: 'LEFT' | 'RIGHT'; line: number };
export type DiffIndex = Map<string, Set<number>>;
export type Publication = {
  kind: 'general' | 'inline';
  body: string;
  payload?: Record<string, unknown>;
  fallbackReason?: string;
  key: string;
};

function validPath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').includes('..')
  );
}
function linesFor(index: DiffIndex, path: string, side: 'LEFT' | 'RIGHT'): Set<number> | undefined {
  return index.get(`${side}:${path}`);
}

export function buildDiffIndex(lines: DiffLine[]): DiffIndex {
  const result: DiffIndex = new Map();
  for (const line of lines) {
    if (!validPath(line.path) || !Number.isInteger(line.line) || line.line < 1) continue;
    const key = `${line.side}:${line.path}`;
    const set = result.get(key) ?? new Set<number>();
    set.add(line.line);
    result.set(key, set);
  }
  return result;
}

export function placement(
  artifact: ReviewArtifact,
  contextCommit: string,
  index: DiffIndex,
):
  | { kind: 'general'; reason?: string }
  | {
      kind: 'inline';
      path: string;
      commit: string;
      side: 'LEFT' | 'RIGHT';
      line: number;
      start_line?: number;
    } {
  const p = artifact.placement;
  if (!p || p.kind === 'general') return { kind: 'general' };
  if (p.commit !== contextCommit) return { kind: 'general', reason: 'stale commit' };
  if (
    !validPath(p.path) ||
    !Number.isInteger(p.line) ||
    p.line < 1 ||
    (p.start_line !== undefined &&
      (!Number.isInteger(p.start_line) || p.start_line < 1 || p.start_line > p.line))
  )
    return { kind: 'general', reason: 'invalid inline location' };
  const eligible = linesFor(index, p.path, p.side);
  if (!eligible) return { kind: 'general', reason: 'path/side is not in PR diff' };
  const start = p.start_line ?? p.line;
  for (let line = start; line <= p.line; line++)
    if (!eligible.has(line))
      return { kind: 'general', reason: 'range contains a non-reviewable line' };
  return {
    kind: 'inline',
    path: p.path,
    commit: p.commit,
    side: p.side,
    line: p.line,
    ...(p.start_line ? { start_line: p.start_line } : {}),
  };
}

export function publishArtifact(
  artifact: ReviewArtifact,
  context: { runId: string; role: 'qa' | 'staff'; round: number; commit: string },
  index: DiffIndex,
): Publication {
  const id = artifact.id ?? createHash('sha256').update(artifact.body).digest('hex').slice(0, 12);
  const key = artifactKey(context.runId, context.role, context.round, id);
  const chosen = placement(artifact, context.commit, index);
  const body = `${marker(key)}\n${artifact.body}`;
  if (chosen.kind === 'general')
    return { kind: 'general', body, fallbackReason: chosen.reason, key };
  return {
    kind: 'inline',
    body,
    key,
    payload: {
      body,
      commit_id: chosen.commit,
      path: chosen.path,
      line: chosen.line,
      side: chosen.side,
      ...(chosen.start_line ? { start_line: chosen.start_line } : {}),
    },
  };
}
