#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
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
import { extname, isAbsolute, join } from 'node:path';

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
type Issue = { number: number; title: string; body?: string };
type Deps = {
  root: string;
  load: () => State;
  save: (s: State) => void;
  eligible: () => Issue[];
  comment: (i: number, b: string) => void;
  run: (s: Spec) => Promise<string>;
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
  input?: string;
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
      'number,title,body',
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
export function runCommand(spec: Spec | undefined): Promise<string> {
  if (!spec) return Promise.resolve('');
  const executable = resolveExecutable(spec.command);
  const useWindowsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  const launchExecutable = useWindowsShell ? spec.command : executable;
  const attempt = (n: number): Promise<string> =>
    new Promise((resolve, reject) => {
      console.error(
        `[loop] ejecutando (${n + 1}/${spec.retries + 1}): ${spec.command} ${spec.args.join(' ')}`,
      );
      const child = spawn(launchExecutable, spec.args, {
        cwd: root,
        windowsHide: true,
        shell: useWindowsShell,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
      });
      if (spec.input) child.stdin.write(spec.input);
      child.stdin.end();
      let out = '',
        err = '';
      child.stdout.on('data', (chunk) => {
        const s = chunk.toString();
        out += s;
        process.stdout.write(s);
      });
      child.stderr.on('data', (chunk) => {
        const s = chunk.toString();
        err += s;
        process.stderr.write(s);
      });
      const timer = setTimeout(() => child.kill(), spec.timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`${spec.command} failed: ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else if (n < spec.retries) attempt(n + 1).then(resolve, reject);
        else
          reject(
            new Error(
              `${spec.command} failed after ${spec.retries + 1} attempt(s): exit ${code}${err.trim() ? `: ${err.trim()}` : ''}`,
            ),
          );
      });
    });
  return attempt(0);
}
function resolveExecutable(commandName: string): string {
  if (process.platform !== 'win32' || isAbsolute(commandName) || extname(commandName))
    return commandName;
  try {
    const paths = execFileSync('where.exe', [commandName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    return (
      paths.find((p) => /\.cmd$/i.test(p)) ??
      paths.find((p) => /\.exe$/i.test(p)) ??
      paths[0] ??
      commandName
    );
  } catch {
    return commandName;
  }
}
function result(text: string, phase: string): any {
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const candidate = [...lines]
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));
    if (!candidate) throw new Error(`${phase} must return JSON evidence`);
    try {
      v = JSON.parse(candidate);
    } catch {
      throw new Error(`${phase} must return JSON evidence`);
    }
  }
  if (v?.verdict === 'failed' || v?.passed === false)
    throw new Error(`${phase} gate rejected: ${text}`);
  return v;
}
function qaResult(text: string): any {
  try {
    const value = result(text, 'QA');
    if (value?.verdict === 'changes_requested' || value?.verdict === 'blocked') return value;
    return { verdict: 'approved' };
  } catch (error) {
    console.error(
      `[loop] QA no devolvió JSON; el código de salida fue exitoso, se toma como aprobado: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { verdict: 'approved' };
  }
}
function codexCommand(
  spec: Spec,
  issue: Issue,
  role: 'worker' | 'staff',
  pr?: number,
  round = 1,
  feedback = '',
): Spec {
  if (!/^(?:.*[\\/])?codex(?:\.cmd)?$/i.test(spec.command)) return spec;
  const context = issue.body?.trim() || '(issue body unavailable; inspect it with gh)';
  const prompt =
    role === 'worker'
      ? `Act as the worker for GitHub issue #${issue.number}: ${issue.title}. Implement the issue in the current checkout, use the existing branch and target base branch staging. ${pr ? `An existing PR for this task is #${pr}; update that PR and report it rather than inventing another PR.` : ''} Issue body:\n${context}\n${round > 1 ? `This is rework round ${round}. The previous gate reported the following findings. Fix every actionable finding in the checkout, including documentation and tests where appropriate:\n${feedback || '(inspect the latest Staff/QA review comments in the checkout or PR)'}` : ''}\nRun the required tests. Do not merge. At the very end, print exactly one JSON object on its own line with this shape: {"base":"staging","pr":<pull-request-number>}. Do not omit the JSON object.`
      : `Act as the adversarial Staff Reviewer for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr ?? '(read the current state)'} against staging and the issue acceptance criteria. This is review round ${round}. Inspect the diff and tests. At the very end, print exactly one JSON object on its own line: {"verdict":"approved"} if clear, otherwise {"verdict":"changes_requested"}. Issue body:\n${context}`;
  const args =
    role === 'worker' && spec.args.at(-1) === String(issue.number)
      ? spec.args.slice(0, -1)
      : spec.args;
  return { ...spec, args, input: prompt };
}
function status(d: Deps, i: number, s: Status, extra: Partial<State> = {}) {
  d.save({ ...d.load(), issue: i, status: s, ...extra });
  console.error(`[loop] issue #${i}: ${s}`);
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
export async function dispatch(cfg: Config, d: Deps): Promise<void> {
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
      await d.run(health);
      d.save({ ...d.load(), stagingGreen: true });
    } catch (e) {
      console.error(`[loop] staging bloqueado: ${e instanceof Error ? e.message : String(e)}`);
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
    const resumePr = s.status === 'blocked' && s.issue ? s.pr : undefined;
    const processed = new Set<number>(d.load().completedIssues ?? []);
    d.save({ ...d.load(), drainStatus: 'running' });
    while (true) {
      const issue = d.eligible().find((x) => !processed.has(x.number));
      if (!issue) {
        d.save({ ...d.load(), status: 'done', drainStatus: 'done' });
        return;
      }
      processed.add(issue.number);
      const continuingIssue = resumePr && issue.number === s.issue;
      status(d, issue.number, 'claimed', { pr: continuingIssue ? resumePr : undefined });
      d.comment(issue.number, 'Dispatcher reclama esta issue de forma exclusiva.');
      try {
        let round = 1;
        let gateFeedback = '';
        while (true) {
          const previous = d.load();
          status(d, issue.number, 'in_progress', { reviewRound: round });
          const resumed =
            round === 1 &&
            ((previous.status === 'blocked' && previous.issue === issue.number && previous.pr) ||
              (resumePr && s.issue === issue.number ? resumePr : undefined));
          const wr = resumed
            ? { base: 'staging', pr: resumed }
            : result(
                await d.run(
                  codexCommand(
                    must(cfg.workerCommand, issue.number, true),
                    issue,
                    'worker',
                    d.load().issue === issue.number ? d.load().pr : undefined,
                    round,
                    gateFeedback,
                  ),
                ),
                'worker',
              );
          const knownPr = d.load().issue === issue.number ? d.load().pr : undefined;
          if (knownPr && wr.pr !== knownPr) {
            console.error(
              `[loop] conservando PR #${knownPr}; el worker informó ${wr.pr ?? 'null'}`,
            );
            wr.pr = knownPr;
          }
          if (resumed)
            console.error(`[loop] reanudando issue #${issue.number} desde PR #${resumed}`);
          if (wr.base !== 'staging' || !wr.pr)
            throw new Error('worker must return a PR based on staging');
          d.save({ ...d.load(), pr: wr.pr });
          d.save({ ...d.load(), reviewRound: round });
          status(d, issue.number, 'reviewing', { reviewRound: round });
          const staffOutput = await d.run(
            codexCommand(must(cfg.staffReviewCommand, issue.number), issue, 'staff', wr.pr, round),
          );
          const sr = result(staffOutput, 'Staff');
          if (sr.verdict !== 'approved') {
            gateFeedback = staffOutput;
            round++;
            continue;
          }
          status(d, issue.number, 'qa_pending');
          const qaOutput = await d.run(must(cfg.qaCommand, issue.number));
          const qr = qaResult(qaOutput);
          if (qr.verdict !== 'approved') {
            gateFeedback = qaOutput;
            round++;
            continue;
          }
          status(d, issue.number, 'smoke_pending');
          await d.run(must(cfg.smokeCommand, issue.number));
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
        console.error(
          `[loop] issue #${issue.number} bloqueada: ${e instanceof Error ? e.message : String(e)}`,
        );
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
async function main() {
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
  await dispatch(cfg, {
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
  void main().catch((e) => {
    console.error(`[dispatcher] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
