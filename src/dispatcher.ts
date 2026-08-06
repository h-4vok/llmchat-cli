#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
};
type Command =
  string[] | { command: string; args?: string[]; timeoutMs?: number; retries?: number };
type Config = {
  workerCommand?: Command;
  staffReviewCommand?: Command;
  qaCommand?: Command;
  smokeCommand?: Command;
  stagingHealthCommand?: Command;
  retries?: number;
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

function load(): State {
  return existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
}
function save(state: State): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}
function gh(args: string[]): string {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function comment(issue: number, body: string): void {
  gh(['issue', 'comment', String(issue), '--body', body]);
}
function eligible(): Array<{ number: number; title: string }> {
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
  ).sort((a: any, b: any) => a.number - b.number);
}
export function command(
  value: Command | undefined,
  issue: number,
  appendIssue = false,
): { command: string; args: string[]; timeoutMs: number; retries: number } | undefined {
  if (!value) return undefined;
  if (
    !Array.isArray(value) &&
    (!value.command ||
      value.command.includes('&&') ||
      value.command.includes('|') ||
      value.command.includes(';'))
  )
    throw new Error(
      'commands must be argv arrays or {command,args}; shell operators are not allowed',
    );
  const c = Array.isArray(value) ? value[0] : value.command;
  return {
    command: c,
    args: [
      ...(Array.isArray(value) ? value.slice(1) : (value.args ?? [])),
      ...(appendIssue ? [String(issue)] : []),
    ],
    timeoutMs: Array.isArray(value) ? 120000 : (value.timeoutMs ?? 120000),
    retries: Array.isArray(value) ? 0 : (value.retries ?? 0),
  };
}
export function runCommand(spec: ReturnType<typeof command>): void {
  if (!spec) return;
  let last: unknown;
  for (let attempt = 0; attempt <= spec.retries; attempt++)
    try {
      execFileSync(spec.command, spec.args, {
        cwd: root,
        stdio: 'inherit',
        timeout: spec.timeoutMs,
        windowsHide: true,
      });
      return;
    } catch (e) {
      last = e;
    }
  throw new Error(
    `${spec.command} failed after ${spec.retries + 1} attempt(s): ${last instanceof Error ? last.message : String(last)}`,
  );
}
function setStatus(issue: number, status: Status, extra: Partial<State> = {}): void {
  save({ ...load(), issue, status, ...extra });
  comment(
    issue,
    `Loop engineering v1: estado ${status}.\n\nSkill activa: ${status === 'in_progress' ? skills.work : status === 'reviewing' ? skills.review : status === 'qa_pending' ? skills.qa : status === 'blocked' ? skills.triage : skills.claim}. No se hace merge automático.`,
  );
}
function claim(): void {
  mkdirSync(stateDir, { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch {
    throw new Error('another dispatcher is already running');
  }
}
function main(): void {
  const args = process.argv.slice(2);
  const state = load();
  if (args.includes('--status')) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (state.status && !['done', 'ready_for_human_merge', 'blocked'].includes(state.status))
    throw new Error(
      `active run exists for issue #${state.issue} (${state.status}); recover or clear ${stateFile}`,
    );
  const cfg: Config = existsSync(join(root, 'loop.config.json'))
    ? JSON.parse(readFileSync(join(root, 'loop.config.json'), 'utf8'))
    : {};
  if (args.includes('--list')) {
    console.log(JSON.stringify(eligible(), null, 2));
    return;
  }
  claim();
  try {
    if (cfg.stagingHealthCommand) {
      try {
        runCommand(command(cfg.stagingHealthCommand, 0));
        save({ ...load(), stagingGreen: true });
      } catch (e) {
        save({ ...load(), status: 'blocked', stagingGreen: false, lastError: String(e) });
        console.error('staging is red; triage required');
        return;
      }
    }
    if (state.status === 'blocked')
      save({ ...load(), status: undefined, issue: undefined, lastError: undefined });
    while (true) {
      const issue = eligible()[0];
      if (!issue) {
        console.error('No eligible issues. Drain complete.');
        return;
      }
      setStatus(issue.number, 'claimed');
      comment(
        issue.number,
        `Dispatcher reclama esta issue de forma exclusiva. Skill: ${skills.claim}.`,
      );
      try {
        setStatus(issue.number, 'in_progress');
        runCommand(command(cfg.workerCommand, issue.number, true));
        setStatus(issue.number, 'reviewing', { reviewRound: 1 });
        runCommand(command(cfg.staffReviewCommand, issue.number));
        setStatus(issue.number, 'qa_pending');
        runCommand(command(cfg.qaCommand, issue.number));
        setStatus(issue.number, 'smoke_pending');
        runCommand(command(cfg.smokeCommand, issue.number));
        setStatus(issue.number, 'ready_for_human_merge');
        comment(
          issue.number,
          '[Worker] loop gates passed; ready_for_human_merge, no merge performed.',
        );
      } catch (e) {
        setStatus(issue.number, 'blocked', {
          lastError: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    }
  } finally {
    if (existsSync(lockDir)) rmSync(lockDir, { recursive: true });
  }
}
if (process.argv[1]?.endsWith('dispatcher.js'))
  try {
    main();
  } catch (e) {
    console.error(`[dispatcher] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
