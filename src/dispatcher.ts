#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type Status =
  | 'queued'
  | 'claimed'
  | 'in_progress'
  | 'reviewing'
  | 'qa_pending'
  | 'smoke_pending'
  | 'ready_for_human_merge'
  | 'blocked'
  | 'done';
export type State = {
  issue?: number;
  status?: Status;
  pr?: number;
  reviewRound?: number;
  attempt?: number;
  stagingGreen?: boolean;
  lastError?: string;
  completedIssues?: number[];
  drainStatus?: 'running' | 'done';
};
type Command =
  string[] | { command: string; args?: string[]; timeoutMs?: number; retries?: number };
type Config = {
  workerCommand?: Command;
  staffReviewCommand?: Command;
  qaCommand?: Command;
  smokeCommand?: Command;
  stagingHealthCommand?: Command;
  stagingRef?: string;
  lockTtlMs?: number;
};
type Issue = { number: number; title: string };
type Deps = {
  root: string;
  load: () => State;
  save: (s: State) => void;
  eligible: () => Issue[];
  comment: (i: number, b: string) => void;
  run: (s: Spec) => string;
  now: () => number;
  pid: () => number;
  onReclaim?: () => void;
};
type Spec = {
  command: string;
  args: string[];
  timeoutMs: number;
  retries: number;
  env?: NodeJS.ProcessEnv;
};

const root = process.cwd();
const stateDir = join(root, '.llmchat');
const stateFile = join(stateDir, 'state.json');
const lockDir = join(stateDir, 'dispatcher.lock');
const skills = {
  claim: 'dispatcher',
  work: 'worker',
  review: 'staff-reviewer',
  qa: 'qa-sdet',
  triage: 'triage-staging',
} as const;
function readState(file = stateFile): State {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return {
      status: 'blocked',
      lastError: `state corruption: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
function writeState(s: State, file = stateFile): void {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  renameSync(tmp, file);
}
function gh(args: string[]): string {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function eligible(): Issue[] {
  return JSON.parse(
    gh([
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      'Automation Ready',
      '--json',
      'number,title',
      '--limit',
      '100',
    ]),
  ).sort((a: Issue, b: Issue) => a.number - b.number);
}
export function command(
  value: Command | undefined,
  issue: number,
  appendIssue = false,
): Spec | undefined {
  if (!value) return undefined;
  if (!Array.isArray(value) && (!value.command || /&&|\||;/.test(value.command)))
    throw new Error(
      'commands must be argv arrays or {command,args}; shell operators are not allowed',
    );
  return {
    command: Array.isArray(value) ? value[0] : value.command,
    args: [
      ...(Array.isArray(value) ? value.slice(1) : (value.args ?? [])),
      ...(appendIssue ? [String(issue)] : []),
    ],
    timeoutMs: Array.isArray(value) ? 120000 : (value.timeoutMs ?? 120000),
    retries: Array.isArray(value) ? 0 : (value.retries ?? 0),
  };
}
export function runCommand(spec: Spec | undefined): string {
  if (!spec) return '';
  let last: unknown;
  for (let a = 0; a <= spec.retries; a++)
    try {
      return execFileSync(spec.command, spec.args, {
        cwd: root,
        encoding: 'utf8',
        timeout: spec.timeoutMs,
        windowsHide: true,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
      }).trim();
    } catch (e) {
      last = e;
    }
  throw new Error(
    `${spec.command} failed after ${spec.retries + 1} attempt(s): ${last instanceof Error ? last.message : String(last)}`,
  );
}
function result(text: string, phase: string): any {
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`${phase} must return JSON evidence`);
  }
  if (v?.verdict === 'failed' || v?.passed === false)
    throw new Error(`${phase} gate rejected: ${text}`);
  return v;
}
function status(d: Deps, i: number, s: Status, extra: Partial<State> = {}) {
  d.save({ ...d.load(), issue: i, status: s, ...extra });
  d.comment(
    i,
    `Loop engineering v1: estado ${s}. Skill activa: ${s === 'in_progress' ? skills.work : s === 'reviewing' ? skills.review : s === 'qa_pending' ? skills.qa : s === 'blocked' ? skills.triage : skills.claim}. No se hace merge automático.`,
  );
}
export function acquire(d: Deps, ttl: number): string {
  const token = randomUUID();
  mkdirSync(join(d.root, '.llmchat'), { recursive: true });
  const lock = join(d.root, '.llmchat', 'dispatcher.lock');
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      mkdirSync(lock);
      writeState({ pid: d.pid(), createdAt: d.now(), token } as any, join(lock, 'owner.json'));
      return token;
    } catch {
      const owner = join(d.root, '.llmchat', 'dispatcher.lock', 'owner.json');
      let stale = false;
      try {
        const x: any = JSON.parse(readFileSync(owner, 'utf8'));
        try {
          process.kill(x.pid, 0);
          stale = false;
        } catch {
          stale = d.now() - x.createdAt > ttl;
        }
      } catch {
        stale = true;
      }
      if (stale) {
        const reclaimed = join(lock, 'reclaiming');
        if (existsSync(reclaimed)) {
          let markerStale = false;
          try {
            const marker: any = JSON.parse(readFileSync(join(reclaimed, 'owner.json'), 'utf8'));
            try {
              process.kill(marker.pid, 0);
            } catch {
              markerStale = d.now() - marker.createdAt > ttl;
            }
          } catch {
            markerStale = d.now() - statSync(reclaimed).mtimeMs > ttl;
          }
          if (!markerStale) throw new Error('another dispatcher is reclaiming the lock');
          rmSync(reclaimed, { recursive: true, force: true });
        }
        try {
          mkdirSync(reclaimed);
          writeState(
            { pid: d.pid(), createdAt: d.now(), token } as any,
            join(reclaimed, 'owner.json'),
          );
          d.onReclaim?.();
          writeState({ pid: d.pid(), createdAt: d.now(), token } as any, join(lock, 'owner.json'));
          rmSync(reclaimed, { recursive: true, force: true });
          return token;
        } catch {
          if (existsSync(reclaimed) && !d.onReclaim)
            rmSync(reclaimed, { recursive: true, force: true });
          continue;
        }
      } else throw new Error('another dispatcher is already running');
    }
  throw new Error('another dispatcher is already running');
}
export function dispatch(cfg: Config, d: Deps): void {
  const s = d.load();
  if (s.status && !['done', 'ready_for_human_merge', 'blocked'].includes(s.status))
    throw new Error(`active run exists for issue #${s.issue}`);
  const lockToken = acquire(d, cfg.lockTtlMs ?? 900000);
  try {
    if (
      !cfg.stagingHealthCommand ||
      !cfg.workerCommand ||
      !cfg.staffReviewCommand ||
      !cfg.qaCommand ||
      !cfg.smokeCommand
    )
      throw new Error(
        'stagingHealthCommand, workerCommand, staffReviewCommand, qaCommand and smokeCommand are required',
      );
    const must = (c: Command, i: number, a = false): Spec => command(c, i, a)!;
    const health = {
      ...must(cfg.stagingHealthCommand, 0),
      env: { LOOP_STAGING_REF: cfg.stagingRef ?? 'staging' },
    };
    try {
      const hs = d.run(health);
      result(hs, 'staging health');
      d.save({ ...d.load(), stagingGreen: true });
    } catch (e) {
      d.save({
        ...d.load(),
        status: 'blocked',
        stagingGreen: false,
        lastError: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    if (s.status === 'blocked')
      d.save({ ...d.load(), status: undefined, issue: undefined, lastError: undefined });
    const processed = new Set<number>(d.load().completedIssues ?? []);
    d.save({ ...d.load(), drainStatus: 'running' });
    while (true) {
      const issue = d.eligible().find((x) => !processed.has(x.number));
      if (!issue) {
        d.save({ ...d.load(), status: 'done', drainStatus: 'done' });
        return;
      }
      processed.add(issue.number);
      status(d, issue.number, 'claimed');
      d.comment(issue.number, 'Dispatcher reclama esta issue de forma exclusiva.');
      try {
        let round = 1;
        while (true) {
          status(d, issue.number, 'in_progress', { reviewRound: round });
          const wr = result(d.run(must(cfg.workerCommand, issue.number, true)), 'worker');
          if (wr.base !== 'staging' || !wr.pr)
            throw new Error('worker must return a PR based on staging');
          d.save({ ...d.load(), pr: wr.pr });
          d.save({ ...d.load(), reviewRound: round });
          status(d, issue.number, 'reviewing', { reviewRound: round });
          const sr = result(d.run(must(cfg.staffReviewCommand, issue.number)), 'Staff');
          if (sr.verdict !== 'approved') {
            round++;
            continue;
          }
          status(d, issue.number, 'qa_pending');
          const qr = result(d.run(must(cfg.qaCommand, issue.number)), 'QA');
          if (qr.verdict !== 'approved') {
            round++;
            continue;
          }
          status(d, issue.number, 'smoke_pending');
          result(d.run(must(cfg.smokeCommand, issue.number)), 'smoke');
          break;
        }
        status(d, issue.number, 'ready_for_human_merge');
        d.save({
          ...d.load(),
          completedIssues: [...new Set([...(d.load().completedIssues ?? []), issue.number])],
        });
        d.comment(
          issue.number,
          '[Worker] loop gates passed; ready_for_human_merge, no merge performed.',
        );
      } catch (e) {
        status(d, issue.number, 'blocked', {
          lastError: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    }
  } finally {
    const owner = join(d.root, '.llmchat', 'dispatcher.lock', 'owner.json');
    try {
      if (JSON.parse(readFileSync(owner, 'utf8')).token === lockToken)
        rmSync(join(d.root, '.llmchat', 'dispatcher.lock'), { recursive: true, force: true });
    } catch {
      /* lock already recovered */
    }
  }
}
function main() {
  const args = process.argv.slice(2),
    s = readState();
  if (args.includes('--status')) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  const cfg: Config = existsSync(join(root, 'loop.config.json'))
    ? JSON.parse(readFileSync(join(root, 'loop.config.json'), 'utf8'))
    : {};
  if (args.includes('--list')) {
    console.log(JSON.stringify(eligible(), null, 2));
    return;
  }
  dispatch(cfg, {
    root,
    load: () => readState(),
    save: writeState,
    eligible,
    comment: (i, b) => gh(['issue', 'comment', String(i), '--body', b]),
    run: runCommand,
    now: Date.now,
    pid: () => process.pid,
  });
}
if (process.argv[1]?.endsWith('dispatcher.js'))
  try {
    main();
  } catch (e) {
    console.error(`[dispatcher] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
