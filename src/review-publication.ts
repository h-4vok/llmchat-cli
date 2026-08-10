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

export type ChangedLines = ReadonlyMap<string, ReadonlyMap<'LEFT' | 'RIGHT', ReadonlySet<number>>>;

function sideLines(
  changedLines: ChangedLines,
  file: string,
  side: 'LEFT' | 'RIGHT',
): ReadonlySet<number> | undefined {
  return changedLines.get(file)?.get(side);
}

export function placement(
  finding: ReviewFinding,
  changedLines: ChangedLines,
): 'inline' | 'general' {
  const side = finding.side ?? 'RIGHT';
  const line = finding.line;
  if (!finding.file || typeof line !== 'number' || !Number.isInteger(line) || line < 1)
    return 'general';
  const lines = sideLines(changedLines, finding.file, side);
  const endLine = finding.endLine ?? line;
  if (!lines || !Number.isInteger(endLine) || endLine < line) return 'general';
  for (let current = line; current <= endLine; current++) if (!lines.has(current)) return 'general';
  return 'inline';
}

export function inlinePayload(
  finding: ReviewFinding,
  commitId: string,
  changedLines: ChangedLines,
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
  changedLines: ChangedLines,
  inline: (payload: ReturnType<typeof inlinePayload>) => Promise<void>,
  general: (body: string) => Promise<void>,
  published = new Set<string>(),
) {
  for (const finding of findings) {
    const key = `${commitId}\0${finding.file ?? ''}\0${finding.line ?? ''}\0${finding.endLine ?? ''}\0${finding.body}`;
    if (published.has(key)) continue;
    published.add(key);
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
