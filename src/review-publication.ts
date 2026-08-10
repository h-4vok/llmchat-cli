export type ReviewFinding = {
  body: string;
  file?: string;
  line?: number;
  endLine?: number;
  side?: 'LEFT' | 'RIGHT';
};

export type ReviewLocation = {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
};

export function placement(
  finding: ReviewFinding,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
): 'inline' | 'general' {
  const line = finding.line;
  if (!finding.file || typeof line !== 'number' || !Number.isInteger(line) || line < 1)
    return 'general';
  const lines = changedLines.get(finding.file);
  if (!lines?.has(line)) return 'general';
  if (
    finding.endLine !== undefined &&
    (!Number.isInteger(finding.endLine) || finding.endLine < line || !lines.has(finding.endLine))
  )
    return 'general';
  return 'inline';
}

export function inlinePayload(
  finding: ReviewFinding,
  commitId: string,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
) {
  if (placement(finding, changedLines) !== 'inline')
    throw new Error('finding location is not a changed PR line');
  const location: ReviewLocation = {
    path: finding.file!,
    line: finding.line!,
    side: finding.side ?? 'RIGHT',
  };
  if (finding.endLine !== undefined) {
    location.start_line = finding.line;
    location.start_side = location.side;
    location.line = finding.endLine;
  }
  return { body: finding.body, commit_id: commitId, ...location };
}

export async function publishFindings(
  findings: readonly ReviewFinding[],
  commitId: string,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
  inline: (payload: ReturnType<typeof inlinePayload>) => Promise<void>,
  general: (body: string) => Promise<void>,
) {
  for (const finding of findings) {
    if (placement(finding, changedLines) !== 'inline') {
      await general(finding.body);
      continue;
    }
    try {
      await inline(inlinePayload(finding, commitId, changedLines));
    } catch {
      await general(`[Inline fallback] ${finding.file}:${finding.line}\n${finding.body}`);
    }
  }
}
