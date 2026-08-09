#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
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
import { tmpdir } from 'node:os';

export type Status =
  | 'queued'
  | 'claimed'
  | 'in_progress'
  | 'worker_running'
  | 'worker_recovery_pending'
  | 'worker_ready_for_review'
  | 'ci_pending'
  | 'ci_failed'
  | 'qa_review_pending'
  | 'qa_changes_requested'
  | 'qa_approved'
  | 'staff_review_pending'
  | 'staff_changes_requested'
  | 'staff_approved'
  | 'review_cap_pending'
  | 'abandon_pending'
  | 'abandoned'
  | 'ready_for_human_merge'
  | 'blocked'
  | 'done';

export type State = {
  issue?: number;
  status?: Status;
  pr?: number;
  branch?: string;
  stagingBaseSha?: string;
  headSha?: string;
  reviewRound?: number;
  attempt?: number;
  stagingGreen?: boolean;
  /** Brief failure explanation retained for legacy readers. */
  lastError?: string;
  /** Full redacted diagnostic, shown only by --status --verbose. */
  lastErrorVerbose?: string;
  lastCiFeedback?: string;
  lastQaFeedback?: string;
  lastStaffFeedback?: string;
  taskContext?: string;
  workerRunId?: string;
  workerPid?: number;
  workerStartedAt?: number;
  workerHeartbeatAt?: number;
  workerRecoveryCount?: number;
  linkedClosingIssues?: number[];
  reviewCap?: {
    capRound: number;
    decisionSha?: string;
    outstandingFindingIds: string[];
    additionalRounds: number;
    waivedFindingIds: string[];
    steer?: string;
    resolvedBy?: string;
    resolvedAt?: string;
  };
  abandonment?: {
    steer: string;
    commentPublished?: boolean;
    prClosed?: boolean;
    labelled?: boolean;
    issueClosed?: boolean;
  };
  completedIssues?: number[];
  drainStatus?: 'running' | 'done';
  updatedAt?: number;
};

export type Check = {
  name: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
};

export type Review = {
  body?: string;
  commitId?: string;
  submittedAt?: string;
  state?: string;
};

export type PullRequest = {
  number: number;
  state?: string;
  baseRefName?: string;
  headRefName?: string;
  headRefOid?: string;
  body?: string;
  mergeStateStatus?: string;
  mergeable?: string;
  reviews?: Review[];
  comments?: Array<{ body?: string; createdAt?: string }>;
  statusCheckRollup?: Check[];
};

type Command =
  string[] | { command: string; args?: string[]; timeoutMs?: number; retries?: number };
type Config = {
  baseBranch?: string;
  workerCommand?: Command;
  staffReviewCommand?: Command;
  qaCommand?: Command;
  requiredPrChecks?: string[];
  checkPollIntervalMs?: number;
  checkTimeoutMs?: number;
  evidencePollIntervalMs?: number;
  evidenceTimeoutMs?: number;
  workerLeaseMs?: number;
  maxReviewRounds?: number;
  codexSandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
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
  pullRequest?: (pr: number) => Promise<PullRequest> | PullRequest;
  now: () => number;
  pid: () => number;
  processAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onReclaim?: () => void;
  prepareWorkerBranch?: (issue: number) => { branch: string; stagingBaseSha: string };
  checkoutWorkerBranch?: (branch: string) => void;
  updatePullRequestBody?: (pr: number, body: string) => void | Promise<void>;
  pullRequestBody?: (pr: number) => string | Promise<string>;
  prComment?: (pr: number, body: string) => void | Promise<void>;
};
type Spec = {
  command: string;
  args: string[];
  timeoutMs: number;
  retries: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  onStart?: (pid: number) => void;
  onHeartbeat?: () => void;
};

const root = process.cwd();
const stateDir = join(root, '.llmchat');
const stateFile = join(stateDir, 'state.json');
const skills = {
  claim: 'dispatcher',
  work: 'worker',
  recovery: 'dispatcher recovery',
  qa: 'qa-sdet',
  staff: 'staff-reviewer',
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
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function dispatcherLockPath(rootPath: string): string {
  const key = createHash('sha256').update(rootPath).digest('hex').slice(0, 16);
  return join(tmpdir(), 'llmchat-cli-dispatcher', key, 'dispatcher.lock');
}

export function recoverStaleLock(rootPath = root, processAlive = defaultProcessAlive): string {
  const lock = dispatcherLockPath(rootPath);
  if (!existsSync(lock)) return 'No dispatcher lock found.';
  const ownerFile = join(lock, 'owner.json');
  if (!existsSync(ownerFile)) throw new Error(`dispatcher lock has no owner file: ${lock}`);
  let owner: { pid?: number };
  try {
    owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
  } catch {
    throw new Error(`dispatcher lock owner is invalid; inspect manually: ${ownerFile}`);
  }
  const pid = owner.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)
    throw new Error(`dispatcher lock owner has no valid PID: ${ownerFile}`);
  if (processAlive(pid))
    throw new Error(`dispatcher owner PID ${pid} is still running; lock was not changed`);
  rmSync(lock, { recursive: true, force: true });
  return `Recovered stale dispatcher lock owned by PID ${pid}.`;
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

export function childProcessInvocation(
  executable: string,
  args: string[],
  platform = process.platform,
  commandProcessor = process.env.ComSpec,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    // cmd.exe must parse batch files, so never pass arbitrary argv entries to
    // its command parser. The dispatcher only needs fixed CLI flags for batch
    // shims; reject syntax that could change the command before spawning it.
    const unsafe = /["%&|<>()^!\r\n]/;
    if (unsafe.test(executable) || args.some((arg) => unsafe.test(arg)))
      throw new Error('Windows batch command contains unsafe cmd.exe syntax');
    return {
      command: commandProcessor || 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/v:off',
        '/c',
        `""${executable}" ${args.map((arg) => `"${arg}"`).join(' ')}"`,
      ],
      windowsVerbatimArguments: true,
    };
  }
  return { command: executable, args };
}

type SyncCommandExecutor = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'pipe'];
    windowsVerbatimArguments?: boolean;
  },
) => string;

export function runSyncCommand(
  executable: string,
  args: string[],
  execute: SyncCommandExecutor = (command, commandArgs, options) =>
    execFileSync(command, commandArgs, options) as string,
  platform = process.platform,
  commandProcessor = process.env.ComSpec,
): string {
  const launch = childProcessInvocation(executable, args, platform, commandProcessor);
  return execute(launch.command, launch.args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  }).trim();
}

function gh(args: string[]): string {
  return runSyncCommand(resolveExecutable('gh'), args);
}

function ghJson<T>(args: string[]): T {
  const output = gh(args);
  try {
    return JSON.parse(output) as T;
  } catch (error) {
    throw new Error(
      `gh returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function eligible(): Issue[] {
  return ghJson<Issue[]>([
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
  ]).sort((a, b) => a.number - b.number);
}

function pullRequest(pr: number): PullRequest {
  const raw = ghJson<any>([
    'pr',
    'view',
    String(pr),
    '--json',
    'number,state,baseRefName,headRefName,headRefOid,body,mergeStateStatus,mergeable,reviews,comments,statusCheckRollup',
  ]);
  return {
    number: raw.number,
    state: raw.state,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    body: raw.body ?? '',
    mergeStateStatus: raw.mergeStateStatus ?? raw.merge_state_status,
    mergeable: raw.mergeable,
    reviews: (raw.reviews ?? []).map((review: any) => ({
      body: review.body,
      state: review.state,
      submittedAt: review.submittedAt ?? review.submitted_at,
      commitId: review.commit?.oid ?? review.commitId ?? review.commit_id,
    })),
    comments: (raw.comments ?? []).map((comment: any) => ({
      body: comment.body,
      createdAt: comment.createdAt ?? comment.created_at,
    })),
    statusCheckRollup: (raw.statusCheckRollup ?? []).map((check: any) => ({
      name: check.name ?? check.context ?? check.workflowName ?? '',
      status: check.status ?? check.state,
      conclusion: check.conclusion ?? check.state,
      detailsUrl: check.detailsUrl ?? check.details_url,
    })),
  };
}

function updatePullRequestBody(pr: number, body: string): void {
  const temp = join(tmpdir(), `llmchat-pr-${process.pid}-${Date.now()}.md`);
  try {
    writeFileSync(temp, body, 'utf8');
    gh(['pr', 'edit', String(pr), '--body-file', temp]);
  } finally {
    rmSync(temp, { force: true });
  }
}

function commentPullRequest(pr: number, body: string): void {
  gh(['pr', 'comment', String(pr), '--body', body]);
}

function commentIssueOnce(issue: number, body: string): void {
  const existing = ghJson<{ comments?: Array<{ body?: string }> }>([
    'issue',
    'view',
    String(issue),
    '--json',
    'comments',
  ]);
  if (!existing.comments?.some((comment) => comment.body === body))
    gh(['issue', 'comment', String(issue), '--body', body]);
}

function commentPullRequestOnce(pr: number, body: string): void {
  if (!(pullRequest(pr).comments ?? []).some((comment) => comment.body === body))
    commentPullRequest(pr, body);
}

function pullRequestBody(pr: number): string {
  return ghJson<{ body?: string }>(['pr', 'view', String(pr), '--json', 'body']).body ?? '';
}

/** Keep every state-authorized GitHub closing reference exactly once in a PR body. */
export function withIssueClosingReference(
  body: string | undefined,
  issue: number,
  linkedIssues: number[] = [],
): string {
  const issues = [...new Set([issue, ...linkedIssues])];
  if (issues.some((number) => !Number.isInteger(number) || number <= 0))
    throw new Error('issue number must be positive');
  const withoutClosingReferences = (body ?? '').replace(
    /^\s*(?:closes|close|closed)\s+#\d+\s*$/gim,
    '',
  );
  return `${withoutClosingReferences.trim()}${withoutClosingReferences.trim() ? '\n\n' : ''}${issues.map((number) => `Closes #${number}`).join('\n')}`;
}

export function command(
  value: Command | undefined,
  _issue: number,
  _appendIssue = false,
): Spec | undefined {
  if (!value) return undefined;
  if (!Array.isArray(value) && (!value.command || /&&|\||;/.test(value.command)))
    throw new Error(
      'commands must be argv arrays or {command,args}; shell operators are not allowed',
    );
  return {
    command: Array.isArray(value) ? value[0] : value.command,
    args: Array.isArray(value) ? value.slice(1) : (value.args ?? []),
    timeoutMs: Array.isArray(value) ? 120000 : (value.timeoutMs ?? 120000),
    retries: Array.isArray(value) ? 0 : (value.retries ?? 0),
  };
}

export function runCommand(spec: Spec | undefined): Promise<string> {
  if (!spec) return Promise.resolve('');
  const executable = resolveExecutable(spec.command);
  const launch = childProcessInvocation(executable, spec.args);
  const attempt = (n: number, failedAttempts: string[] = []): Promise<string> =>
    new Promise((resolve, reject) => {
      console.error(
        `[sloop] ejecutando (${n + 1}/${spec.retries + 1}): ${spec.command} ${spec.args.join(' ')}`,
      );
      const child = spawn(launch.command, launch.args, {
        cwd: root,
        windowsHide: true,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
      spec.onStart?.(child.pid ?? -1);
      const heartbeat = () => spec.onHeartbeat?.();
      heartbeat();
      if (spec.input) child.stdin.write(spec.input);
      child.stdin.end();
      let out = '',
        err = '';
      child.stdout.on('data', (chunk) => {
        heartbeat();
        const s = chunk.toString();
        out += s;
        process.stdout.write(s);
      });
      child.stderr.on('data', (chunk) => {
        heartbeat();
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
        else {
          const attemptDiagnostic = [
            `attempt ${n + 1}: exit ${code}`,
            out ? `stdout:\n${out}` : '',
            err ? `stderr:\n${err}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          const diagnostics = [...failedAttempts, attemptDiagnostic];
          if (n < spec.retries) attempt(n + 1, diagnostics).then(resolve, reject);
          else {
            const diagnostic = [
              `${spec.command} failed after ${spec.retries + 1} attempt(s)`,
              ...diagnostics,
            ].join('\n');
            reject(new Error(diagnostic));
          }
        }
      });
    });
  return attempt(0);
}

function defaultProcessAlive(pid: number): boolean {
  if (!pid || pid < 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isWorkerStatus(status: Status | undefined): boolean {
  return status === 'worker_running' || status === 'in_progress';
}

function isActiveStatus(status: Status | undefined): boolean {
  return Boolean(
    status && !['done', 'ready_for_human_merge', 'blocked', 'abandoned'].includes(status),
  );
}

function hasPersistedRecoveryContext(state: State): boolean {
  return Boolean(state.pr || state.branch);
}

function isStaleWorker(s: State, cfg: Config, d: Deps): boolean {
  if (!isWorkerStatus(s.status)) return false;
  if (typeof s.workerPid === 'number') return !(d.processAlive ?? defaultProcessAlive)(s.workerPid);
  const lastHeartbeat = s.workerHeartbeatAt ?? s.workerStartedAt;
  return Boolean(lastHeartbeat && d.now() - lastHeartbeat > (cfg.workerLeaseMs ?? 900000));
}

function skillFor(status: Status | undefined): string {
  if (status === 'worker_running' || status === 'in_progress') return skills.work;
  if (status === 'worker_recovery_pending') return skills.recovery;
  if (status?.startsWith('qa_')) return skills.qa;
  if (status?.startsWith('staff_')) return skills.staff;
  return skills.claim;
}

function status(d: Deps, issue: number, next: Status, extra: Partial<State> = {}): void {
  const current = d.load();
  const diagnostic =
    extra.lastError ??
    (['ci_failed', 'qa_changes_requested', 'staff_changes_requested'].includes(next)
      ? (extra.lastCiFeedback ?? extra.lastQaFeedback ?? extra.lastStaffFeedback)
      : undefined);
  const errors = diagnostic === undefined ? {} : normalizedError(next, diagnostic, current);
  d.save({ ...current, issue, status: next, updatedAt: d.now(), ...extra, ...errors });
  console.error(`[sloop] issue #${issue}: ${next}`);
  d.comment(
    issue,
    `Sloop engineering v2: estado ${next}. Skill activa: ${skillFor(next)}. QA precede a Staff; no se hace merge automático.`,
  );
}

export function redactDiagnostic(value: string): string {
  const sensitiveKey = String.raw`(?:authorization|(?:[A-Za-z][A-Za-z0-9_]*_)?token|(?:[A-Za-z][A-Za-z0-9_]*_)?api[_-]?key|(?:[A-Za-z][A-Za-z0-9_]*_)?secret|(?:[A-Za-z][A-Za-z0-9_]*_)?password|(?:[A-Za-z][A-Za-z0-9_]*_)?cookie|(?:[A-Za-z][A-Za-z0-9_]*_)?credentials?)`;
  const assignedSecret = new RegExp(
    String.raw`((?:["']${sensitiveKey}["']|${sensitiveKey})\s*[:=]\s*)(?:Bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)`,
    'gi',
  );
  return value
    .replace(/(^|\r?\n)(\s*(?:proxy-)?authorization\s*:\s*)[^\r\n]*/gi, '$1$2[REDACTED]')
    .replace(assignedSecret, '$1[REDACTED]')
    .replace(/\bBearer\s+[-._~+/=A-Za-z0-9]{8,}\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:ghp|github_pat|sk|xox[baprs])[-_A-Za-z0-9]+\b/gi, '[REDACTED]');
}

function normalizedError(
  phase: Status,
  diagnostic: unknown,
  state: State,
): Pick<State, 'lastError' | 'lastErrorVerbose'> {
  const verbose = redactDiagnostic(String(diagnostic ?? ''));
  const firstLine = verbose
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const context = [state.issue ? `issue #${state.issue}` : '', state.pr ? `PR #${state.pr}` : '']
    .filter(Boolean)
    .join(', ');
  const detail = firstLine
    ? ` Observed output begins: ${firstLine
        .replace(/[.!?]+/g, ',')
        .replace(/\s+/g, ' ')
        .slice(0, 400)}.`
    : ' No diagnostic output was available.';
  return {
    lastError: `The loop stopped during ${phase.replaceAll('_', ' ')}${context ? ` for ${context}` : ''}.${detail} See verbose diagnostics for the complete output.`,
    lastErrorVerbose:
      verbose || `No diagnostic output was captured during ${phase.replaceAll('_', ' ')}.`,
  };
}

function claimNewIssue(d: Deps, issue: number): void {
  const current = d.load();
  d.save({
    completedIssues: current.completedIssues ?? [],
    stagingGreen: current.stagingGreen,
    issue,
    status: 'claimed',
    reviewRound: 1,
    drainStatus: 'running',
    updatedAt: d.now(),
  });
  console.error(`[sloop] issue #${issue}: claimed`);
  d.comment(
    issue,
    `Sloop engineering v2: estado claimed. Skill activa: ${skillFor('claimed')}. QA precede a Staff; no se hace merge automÃ¡tico.`,
  );
}

function rolePrompt(
  issue: Issue,
  role: 'worker' | 'qa' | 'staff',
  pr: number | undefined,
  round: number,
  context: string,
  feedback: string,
  headSha: string | undefined,
  runId: string,
  initialPrBody?: string,
): string {
  const issueContext = issue.body?.trim() || '(issue body unavailable; inspect it with gh)';
  if (role === 'worker')
    return `Use the worker skill for GitHub issue #${issue.number}: ${issue.title}. This is dispatcher recovery run ${runId}, review round ${round}. Continue the existing task in the current checkout. ${pr ? `An existing PR is #${pr}; update that PR and never create a second PR.` : 'Create exactly one PR targeting staging if one does not exist.'} Do not merge. The claimed issue number is ${issue.number} (also in LLMCHAT_ISSUE_NUMBER). The dispatcher has generated the initial PR body in LLMCHAT_PR_BODY: ${JSON.stringify(initialPrBody ?? '')}. If creating a PR, pass that exact value to gh pr create using --body-file (or an equivalent file-based body argument); do not construct the closing reference yourself. When updating the PR, preserve every state-authorized closing reference supplied in the recovery context exactly once; do not add or remove other issue links without dispatcher instruction. Use gh pr create/edit (or equivalent) to persist that body. Inspect the issue, current PR diff, CI checks, mergeability, and all [QA/SDET Review] and [Staff Review] feedback. If the PR is CONFLICTING or DIRTY against staging, update the branch from staging, resolve every conflict, run the required checks, and do not report ready_for_review until the PR is clean and mergeable. Resolve every actionable finding and publish one PR conversation comment beginning with [Worker], including round=${round}, status=ready_for_review, pr=<number>, base=staging, and commit=<current head SHA>. In that evidence include a [Human Verification] JSON code block with non-empty summary, steps, expected, isolation, limitations, and checklist fields. Make the steps concrete, safe, and isolated; state diagnostics for failures; do not claim automated checks that were not run. The dispatcher will validate and publish the guide only after CI, QA, and Staff pass. Never delete or modify .llmchat/state.json or dispatcher runtime state. Exit 0 only after the work, conflict resolution, and comment are complete; do not return JSON. Issue body:\n${issueContext}\n${context ? `Recovered context:\n${context}\n` : ''}${feedback ? `Actionable feedback to resolve:\n${feedback}\n` : ''}At the end, print a plain-text line exactly like WORKER_RESULT pr=<number> base=staging. All command success/failure is communicated by the process exit code.`;
  if (role === 'qa')
    return `Use the qa-sdet skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against staging before Staff. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Inspect the acceptance criteria, diff, CI check results, regression coverage, and smoke evidence. Publish directly to the PR exactly one review beginning [QA/SDET Review] round=${round} verdict=passed, changes_requested, or blocked. Include Q<n> findings, exact evidence, and commit=${headSha ?? 'current'}. Do not edit code or merge. Exit 0 after publishing the review; do not return JSON. Issue body:\n${issueContext}`;
  return `Use the staff-reviewer skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against staging after QA has passed. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Perform the independent adversarial review for design, security, regressions, boundaries, and abuse cases. Publish directly to the PR exactly one review beginning [Staff Review] round=${round} verdict=approved or changes_requested, include S<n> findings when needed, and include commit=${headSha ?? 'current'}. Do not edit code or merge. Exit 0 after publishing the review; do not return JSON. Issue body:\n${issueContext}`;
}

function roleCommand(value: Command | undefined, issue: number, cfg: Config): Spec | undefined {
  const spec = command(value, issue);
  if (!spec) return undefined;
  if (
    /^(?:.*[\\/])?codex(?:\.cmd)?$/i.test(spec.command) &&
    spec.args[0] === 'exec' &&
    !spec.args.includes('--dangerously-bypass-approvals-and-sandbox') &&
    !spec.args.includes('--sandbox')
  ) {
    return {
      ...spec,
      args: [...spec.args, '--sandbox', cfg.codexSandbox ?? 'read-only'],
    };
  }
  return spec;
}

function workerMetadata(output: string, knownPr?: number): { pr?: number; base?: string } {
  const match = output.match(/^\s*WORKER_RESULT\s+pr=(\d+)\s+base=([^\s]+)\s*$/im);
  if (match) return { pr: Number(match[1]), base: match[2] };
  if (knownPr) return { pr: knownPr, base: 'staging' };
  throw new Error('Worker must exit 0 and print WORKER_RESULT pr=<number> base=staging');
}

function roundFromBody(body: string | undefined): number | undefined {
  const match = body?.match(/\bround=(\d+)\b/i);
  return match ? Number(match[1]) : undefined;
}

function hasCommit(body: string | undefined, headSha: string | undefined): boolean {
  if (!headSha) return true;
  const match = body?.match(/\bcommit=([^\s]+)/i)?.[1];
  return Boolean(match && headSha.startsWith(match));
}

function latestWorkerComment(pr: PullRequest, round: number, headSha?: string) {
  return [...(pr.comments ?? [])]
    .filter(
      (comment) =>
        comment.body?.trim().startsWith('[Worker]') &&
        roundFromBody(comment.body) === round &&
        hasCommit(comment.body, headSha),
    )
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .at(-1);
}

type HumanReviewGuide = {
  summary: string;
  steps: string[];
  expected: string[];
  isolation: string;
  limitations: string[];
  checklist: string[];
};

const humanReviewGuideMarker = '<!-- llmchat-dispatcher-human-review-guide -->';

function humanReviewGuide(comment: { body?: string } | undefined): HumanReviewGuide | undefined {
  const match = comment?.body?.match(/\[Human Verification\]\s*```json\s*([\s\S]*?)```/i);
  if (!match) return undefined;
  try {
    const guide = JSON.parse(match[1]) as Partial<HumanReviewGuide>;
    const strings = (value: unknown) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && item.trim());
    if (
      typeof guide.summary !== 'string' ||
      !guide.summary.trim() ||
      !strings(guide.steps) ||
      !strings(guide.expected) ||
      typeof guide.isolation !== 'string' ||
      !guide.isolation.trim() ||
      !strings(guide.limitations) ||
      !strings(guide.checklist)
    )
      return undefined;
    return guide as HumanReviewGuide;
  } catch {
    return undefined;
  }
}

function renderedHumanReviewGuide(guide: HumanReviewGuide, round: number, commit: string): string {
  return (
    `[Human Review Guide] round=${round} commit=${commit}\n${humanReviewGuideMarker}\n\n` +
    `Summary\n${guide.summary}\n\n` +
    `Steps\n${guide.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n` +
    `Expected results\n${guide.expected.map((item) => `- ${item}`).join('\n')}\n\n` +
    `Isolation\n${guide.isolation}\n\n` +
    `Limitations / diagnostics\n${guide.limitations.map((item) => `- ${item}`).join('\n')}\n\n` +
    `Approval checklist\n${guide.checklist.map((item) => `- [ ] ${item}`).join('\n')}`
  );
}

function isRenderedHumanReviewGuide(body: string | undefined, commit: string): boolean {
  if (!body?.trim().startsWith(`[Human Review Guide]`) || !body.includes(`commit=${commit}`))
    return false;
  const requiredSections = [
    /\n\nSummary\n\S/,
    /\n\nSteps\n1\.\s+\S/,
    /\n\nExpected results\n-\s+\S/,
    /\n\nIsolation\n\S/,
    /\n\nLimitations \/ diagnostics\n-\s+\S/,
    /\n\nApproval checklist\n- \[ \]\s+\S/,
  ];
  return (
    body.includes(humanReviewGuideMarker) && requiredSections.every((section) => section.test(body))
  );
}

function publishHumanReviewGuide(d: Deps, pr: PullRequest, round: number): void {
  const guide = humanReviewGuide(latestWorkerComment(pr, round, pr.headRefOid));
  if (!guide || !pr.headRefOid)
    throw new Error('Worker evidence must contain a complete [Human Verification] guide');
  const commit = pr.headRefOid;
  const currentGuides = (pr.comments ?? []).filter(
    (comment) =>
      comment.body?.trim().startsWith('[Human Review Guide]') &&
      comment.body?.match(/\bcommit=([^\s]+)/i)?.[1] === commit,
  );
  if (currentGuides.length > 1)
    throw new Error(
      `Expected exactly one [Human Review Guide] for commit ${commit}; found duplicates`,
    );
  if (currentGuides.length === 1) {
    if (isRenderedHumanReviewGuide(currentGuides[0].body, commit)) return;
    throw new Error(`Current [Human Review Guide] for commit ${commit} is not dispatcher-rendered`);
  }
  d.comment(pr.number, renderedHumanReviewGuide(guide, round, commit));
}

function latestReview(
  pr: PullRequest,
  marker: '[QA/SDET Review]' | '[Staff Review]',
  round: number,
  headSha?: string,
): Review | undefined {
  return [...(pr.reviews ?? [])]
    .filter(
      (review) =>
        review.body?.trim().startsWith(marker) &&
        roundFromBody(review.body) === round &&
        (!headSha || !review.commitId || headSha === review.commitId),
    )
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
    .at(-1);
}

function reviewVerdict(body: string | undefined): string | undefined {
  return body?.match(/\bverdict=([a-z_]+)\b/i)?.[1]?.toLowerCase();
}

async function waitForEvidence(
  d: Deps,
  cfg: Config,
  prNumber: number,
  predicate: (pr: PullRequest) => boolean,
): Promise<PullRequest> {
  if (!d.pullRequest) throw new Error('GitHub PR evidence adapter is required');
  const deadline = d.now() + (cfg.evidenceTimeoutMs ?? 60000);
  let latest: PullRequest | undefined;
  do {
    latest = await d.pullRequest(prNumber);
    if (predicate(latest)) return latest;
    if (d.now() >= deadline) break;
    await (d.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
      cfg.evidencePollIntervalMs ?? 2000,
    );
  } while (d.now() < deadline);
  return latest!;
}

function normalizeCheckStatus(check: Check): { complete: boolean; passed: boolean } {
  const status = String(check.status ?? '').toLowerCase();
  const conclusion = String(check.conclusion ?? '').toLowerCase();
  const complete =
    conclusion !== '' &&
    !['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(status);
  const passed = complete && ['success', 'passed', 'neutral', 'skipped'].includes(conclusion);
  return { complete, passed };
}

function checkFeedback(checks: Check[], required: string[]): string {
  return required
    .map((name) => {
      const check = checks.find((candidate) => candidate.name === name);
      if (!check) return `[CI] missing required check: ${name}`;
      return `[CI] ${name}: ${check.conclusion ?? check.status ?? 'unknown'}${check.detailsUrl ? ` ${check.detailsUrl}` : ''}`;
    })
    .join('\n');
}

async function waitForCi(
  d: Deps,
  cfg: Config,
  issue: number,
  prNumber: number,
): Promise<{ passed: boolean; evidence: PullRequest; feedback?: string }> {
  if (!d.pullRequest) throw new Error('GitHub PR evidence adapter is required');
  const required = cfg.requiredPrChecks ?? ['pr-checks'];
  const deadline = d.now() + (cfg.checkTimeoutMs ?? 900000);
  let latest = await d.pullRequest(prNumber);
  status(d, issue, 'ci_pending', { pr: prNumber, headSha: latest.headRefOid });
  while (true) {
    const checks = latest.statusCheckRollup ?? [];
    const selected = required.map((name) => checks.find((check) => check.name === name));
    const failed = selected.find(
      (check) =>
        check && normalizeCheckStatus(check).complete && !normalizeCheckStatus(check).passed,
    );
    if (failed) {
      const feedback = checkFeedback(checks, required);
      status(d, issue, 'ci_failed', { lastCiFeedback: feedback, stagingGreen: false });
      return { passed: false, evidence: latest, feedback };
    }
    if (
      selected.every(
        (check) =>
          check && normalizeCheckStatus(check).complete && normalizeCheckStatus(check).passed,
      )
    ) {
      const feedback = checkFeedback(checks, required);
      d.save({
        ...d.load(),
        stagingGreen: true,
        lastCiFeedback: feedback,
        headSha: latest.headRefOid,
      });
      return { passed: true, evidence: latest };
    }
    if (d.now() >= deadline)
      throw new Error(
        `required PR checks did not finish before timeout: ${checkFeedback(checks, required)}`,
      );
    console.error(
      `[sloop] issue #${issue}: esperando checks del PR #${prNumber}: ${checkFeedback(checks, required)}`,
    );
    await (d.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
      cfg.checkPollIntervalMs ?? 5000,
    );
    latest = await d.pullRequest(prNumber);
  }
}

function reviewFeedback(
  pr: PullRequest,
  marker: '[QA/SDET Review]' | '[Staff Review]',
  round: number,
): string {
  return (pr.reviews ?? [])
    .filter(
      (review) => review.body?.trim().startsWith(marker) && roundFromBody(review.body) === round,
    )
    .map((review) => review.body)
    .filter(Boolean)
    .join('\n\n');
}

function withWorkerLifecycle(d: Deps, spec: Spec, issue: number, runId: string): Spec {
  return {
    ...spec,
    input: spec.input,
    onStart: (pid) => {
      d.save({
        ...d.load(),
        issue,
        status: 'worker_running',
        workerRunId: runId,
        workerPid: pid,
        workerStartedAt: d.now(),
        workerHeartbeatAt: d.now(),
        updatedAt: d.now(),
      });
    },
    onHeartbeat: () => {
      d.save({ ...d.load(), workerHeartbeatAt: d.now(), updatedAt: d.now() });
    },
  };
}

async function runWorker(
  cfg: Config,
  d: Deps,
  issue: Issue,
  round: number,
  pr: number | undefined,
  context: string,
  feedback: string,
): Promise<number> {
  if (cfg.baseBranch !== undefined && cfg.baseBranch !== 'staging')
    throw new Error(`Worker PR baseBranch must be staging; found ${cfg.baseBranch}`);
  if (!cfg.workerCommand) throw new Error('workerCommand is required');
  const runId = randomUUID();
  status(d, issue.number, 'worker_recovery_pending', {
    workerRunId: runId,
    workerRecoveryCount: (d.load().workerRecoveryCount ?? 0) + 1,
    reviewRound: round,
    lastError: undefined,
    lastErrorVerbose: undefined,
  });
  const spec = roleCommand(cfg.workerCommand, issue.number, cfg);
  if (!spec) throw new Error('workerCommand is required');
  const initialPrBody = withIssueClosingReference(
    '',
    issue.number,
    d.load().linkedClosingIssues ?? [],
  );
  const output = await d.run(
    withWorkerLifecycle(
      d,
      {
        ...spec,
        env: {
          ...spec.env,
          LLMCHAT_ISSUE_NUMBER: String(issue.number),
          LLMCHAT_PR_BODY: initialPrBody,
        },
        input: rolePrompt(
          issue,
          'worker',
          pr,
          round,
          context,
          feedback,
          d.load().headSha,
          runId,
          initialPrBody,
        ),
      },
      issue.number,
      runId,
    ),
  );
  const metadata = workerMetadata(output, pr);
  if (!metadata.pr || metadata.base !== (cfg.baseBranch ?? 'staging'))
    throw new Error('Worker must report an existing PR based on staging');
  if (!d.pullRequest) throw new Error('GitHub PR evidence adapter is required');
  const currentBody = await (d.pullRequestBody ?? pullRequestBody)(metadata.pr);
  const normalizedBody = withIssueClosingReference(
    currentBody,
    issue.number,
    d.load().linkedClosingIssues ?? [],
  );
  if (normalizedBody !== currentBody.trim())
    await (d.updatePullRequestBody ?? updatePullRequestBody)(metadata.pr, normalizedBody);
  d.save({ ...d.load(), pr: metadata.pr, workerPid: undefined, workerHeartbeatAt: d.now() });
  const evidence = await waitForEvidence(d, cfg, metadata.pr, (candidate) => {
    const head = candidate.headRefOid;
    return Boolean(latestWorkerComment(candidate, round, head));
  });
  if (!latestWorkerComment(evidence, round, evidence.headRefOid))
    throw new Error(
      `Worker exited successfully but did not publish [Worker] evidence on PR #${metadata.pr}`,
    );
  if (evidence.baseRefName !== (cfg.baseBranch ?? 'staging'))
    throw new Error(`PR #${metadata.pr} must target ${cfg.baseBranch ?? 'staging'}`);
  const expectedWorkerBranch = workerBranchName(issue.number);
  if (evidence.headRefName !== expectedWorkerBranch)
    throw new Error(
      `PR #${metadata.pr} must use worker branch ${expectedWorkerBranch}; found ${evidence.headRefName}`,
    );
  if (
    evidence.mergeable?.toUpperCase() === 'CONFLICTING' ||
    evidence.mergeStateStatus?.toUpperCase() === 'DIRTY'
  )
    throw new Error(
      `PR #${metadata.pr} remains conflicting or dirty against ${cfg.baseBranch ?? 'staging'}`,
    );
  d.save({
    ...d.load(),
    pr: metadata.pr,
    branch: d.load().branch ?? evidence.headRefName,
    headSha: evidence.headRefOid,
    workerPid: undefined,
    workerHeartbeatAt: d.now(),
  });
  status(d, issue.number, 'worker_ready_for_review', {
    pr: metadata.pr,
    branch: d.load().branch ?? evidence.headRefName,
    headSha: evidence.headRefOid,
  });
  return metadata.pr;
}

async function runReview(
  cfg: Config,
  d: Deps,
  issue: Issue,
  role: 'qa' | 'staff',
  prNumber: number,
  round: number,
  evidence: PullRequest,
): Promise<{ verdict?: string; body?: string; evidence: PullRequest }> {
  const marker = role === 'qa' ? '[QA/SDET Review]' : '[Staff Review]';
  const pending: Status = role === 'qa' ? 'qa_review_pending' : 'staff_review_pending';
  if (role === 'qa')
    status(d, issue.number, pending, { pr: prNumber, headSha: evidence.headRefOid });
  else status(d, issue.number, pending, { pr: prNumber, headSha: evidence.headRefOid });
  const configured = role === 'qa' ? cfg.qaCommand : cfg.staffReviewCommand;
  if (!configured) throw new Error(`${role} command is required`);
  const spec = roleCommand(configured, issue.number, cfg);
  if (!spec) throw new Error(`${role} command is required`);
  await d.run({
    ...spec,
    input: rolePrompt(
      issue,
      role,
      prNumber,
      round,
      d.load().taskContext ?? '',
      role === 'qa' ? (d.load().lastQaFeedback ?? '') : (d.load().lastStaffFeedback ?? ''),
      evidence.headRefOid,
      d.load().workerRunId ?? 'dispatcher-run',
    ),
  });
  const latest = await waitForEvidence(d, cfg, prNumber, (candidate) =>
    Boolean(latestReview(candidate, marker, round, candidate.headRefOid)),
  );
  const review = latestReview(latest, marker, round, latest.headRefOid);
  if (!review)
    throw new Error(`${role} exited successfully but did not publish ${marker} on PR #${prNumber}`);
  return { verdict: reviewVerdict(review.body), body: review.body, evidence: latest };
}

function effectiveMaxRounds(cfg: Config, state: State): number {
  return (cfg.maxReviewRounds ?? 10) + (state.reviewCap?.additionalRounds ?? 0);
}

function findingIds(feedback: string): string[] {
  return [
    ...new Set(
      feedback
        .split(/\r?\n/)
        .filter((line) => /\[([QS]\d+)\]\s+(?:fail|blocked|high|critical|medium|low)\b/i.test(line))
        .map((line) => line.match(/\[([QS]\d+)\]/i)?.[1].toUpperCase())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

async function pauseForReviewCap(cfg: Config, d: Deps, issue: Issue, round: number): Promise<void> {
  const current = d.load();
  const feedback = [current.lastQaFeedback, current.lastStaffFeedback].filter(Boolean).join('\n');
  const cap = {
    capRound: cfg.maxReviewRounds ?? 10,
    decisionSha: current.headSha,
    outstandingFindingIds: findingIds(feedback),
    additionalRounds: current.reviewCap?.additionalRounds ?? 0,
    waivedFindingIds: current.reviewCap?.waivedFindingIds ?? [],
    steer: current.reviewCap?.steer,
  };
  status(d, issue.number, 'review_cap_pending', { reviewRound: round, reviewCap: cap });
  const notice = `[HITL Review Cap] round=${round} cap=${effectiveMaxRounds(cfg, current)} sha=${current.headSha ?? 'unknown'} outstanding=${cap.outstandingFindingIds.join(',') || 'none'}. Resolve with npm run sloop -- --resolve-review-cap --steer "..." plus --additional-rounds N, --waive <Q/S>, --waive-all-outstanding, or --abandon.`;
  d.comment(issue.number, notice);
  if (current.pr) await d.prComment?.(current.pr, notice);
}

async function processIssue(cfg: Config, d: Deps, issue: Issue): Promise<void> {
  let current = d.load();
  let round = current.reviewRound ?? 1;
  let pr = current.pr;
  let feedback = [current.lastCiFeedback, current.lastQaFeedback, current.lastStaffFeedback]
    .filter(Boolean)
    .join('\n\n');
  if (current.reviewCap?.steer)
    feedback = `${feedback}${feedback ? '\n\n' : ''}HITL steer (binding): ${current.reviewCap.steer}. Waived findings at ${current.reviewCap.decisionSha ?? 'the decision SHA'}: ${(current.reviewCap.waivedFindingIds ?? []).join(', ') || 'none'}.`;
  if (round > effectiveMaxRounds(cfg, current)) {
    await pauseForReviewCap(cfg, d, issue, round);
    return;
  }
  const needsWorker = ![
    'worker_ready_for_review',
    'ci_pending',
    'ci_failed',
    'qa_review_pending',
    'qa_approved',
    'staff_review_pending',
    'staff_approved',
  ].includes(current.status ?? 'queued');
  if (
    needsWorker ||
    current.status === 'ci_failed' ||
    current.status === 'qa_changes_requested' ||
    current.status === 'staff_changes_requested'
  ) {
    pr = await runWorker(cfg, d, issue, round, pr, current.taskContext ?? '', feedback);
    current = d.load();
  }
  if (!pr) throw new Error('dispatcher requires a PR before CI and reviews');

  while (true) {
    current = d.load();
    if (round > effectiveMaxRounds(cfg, current)) {
      await pauseForReviewCap(cfg, d, issue, round);
      return;
    }
    const resumeAtStaff = ['qa_approved', 'staff_review_pending'].includes(current.status ?? '');
    const shouldRunQa = !resumeAtStaff;
    const ci =
      current.status === 'ci_pending' || current.status === 'ci_failed'
        ? await waitForCi(d, cfg, issue.number, pr)
        : await waitForCi(d, cfg, issue.number, pr);
    if (!ci.passed) {
      feedback = ci.feedback ?? 'Required PR checks failed.';
      d.save({ ...d.load(), lastCiFeedback: feedback, reviewRound: round });
      round += 1;
      if (round > effectiveMaxRounds(cfg, d.load())) {
        await pauseForReviewCap(cfg, d, issue, round);
        return;
      }
      pr = await runWorker(cfg, d, issue, round, pr, d.load().taskContext ?? '', feedback);
      continue;
    }

    let evidence = ci.evidence;
    if (shouldRunQa) {
      const qa = await runReview(cfg, d, issue, 'qa', pr, round, evidence);
      evidence = qa.evidence;
      const qaPassed = qa.verdict === 'passed' || qa.verdict === 'approved';
      if (!qaPassed) {
        const qaFeedback = qa.body ?? 'QA requested changes or was blocked.';
        d.save({ ...d.load(), lastQaFeedback: qaFeedback, headSha: evidence.headRefOid });
        status(d, issue.number, 'qa_changes_requested', { lastQaFeedback: qaFeedback });
        feedback = qaFeedback;
        round += 1;
        if (round > effectiveMaxRounds(cfg, d.load())) {
          await pauseForReviewCap(cfg, d, issue, round);
          return;
        }
        pr = await runWorker(cfg, d, issue, round, pr, d.load().taskContext ?? '', feedback);
        continue;
      }
      status(d, issue.number, 'qa_approved', {
        headSha: evidence.headRefOid,
        lastQaFeedback: qa.body,
      });
    }

    const staff = await runReview(cfg, d, issue, 'staff', pr, round, evidence);
    evidence = staff.evidence;
    if (staff.verdict !== 'approved') {
      const staffFeedback = staff.body ?? 'Staff requested changes.';
      d.save({ ...d.load(), lastStaffFeedback: staffFeedback, headSha: evidence.headRefOid });
      status(d, issue.number, 'staff_changes_requested', { lastStaffFeedback: staffFeedback });
      feedback = staffFeedback;
      round += 1;
      if (round > effectiveMaxRounds(cfg, d.load())) {
        await pauseForReviewCap(cfg, d, issue, round);
        return;
      }
      pr = await runWorker(cfg, d, issue, round, pr, d.load().taskContext ?? '', feedback);
      continue;
    }
    status(d, issue.number, 'staff_approved', {
      headSha: evidence.headRefOid,
      lastStaffFeedback: staff.body,
    });
    publishHumanReviewGuide(d, evidence, round);
    status(d, issue.number, 'ready_for_human_merge', { pr, headSha: evidence.headRefOid });
    d.save({
      ...d.load(),
      completedIssues: [...new Set([...(d.load().completedIssues ?? []), issue.number])],
      workerPid: undefined,
      drainStatus: 'running',
    });
    d.comment(
      issue.number,
      '[Worker] sloop gates passed; ready_for_human_merge, no merge performed.',
    );
    return;
  }
}

export function prepareRecovery(
  state: State,
  issue: number,
  pr: number,
  now: number,
  leaseMs: number,
): State {
  const staleAt = now - leaseMs - 1;
  return {
    ...state,
    issue,
    pr,
    status: 'worker_running',
    workerRunId: randomUUID(),
    workerPid: -1,
    workerStartedAt: staleAt,
    workerHeartbeatAt: staleAt,
    workerRecoveryCount: state.workerRecoveryCount ?? 0,
    reviewRound: state.reviewRound ?? 1,
    completedIssues: (state.completedIssues ?? []).filter((number) => number !== issue),
    lastError: undefined,
    lastErrorVerbose: undefined,
    drainStatus: 'running',
    updatedAt: now,
  };
}

export function workerBranchName(issue: number): string {
  if (!Number.isInteger(issue) || issue <= 0) throw new Error('issue number must be positive');
  return `codex/issue-${issue}`;
}

export function prepareWorkerBranch(
  issue: number,
  cwd = root,
): { branch: string; stagingBaseSha: string } {
  const branch = workerBranchName(issue);
  execFileSync('git', ['fetch', 'origin', 'staging'], { cwd, stdio: 'inherit' });
  const stagingBaseSha = execFileSync('git', ['rev-parse', 'origin/staging'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd,
      stdio: 'ignore',
    });
    throw new Error(`worker branch ${branch} already exists; refusing to overwrite it`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) throw error;
  }
  execFileSync('git', ['checkout', '-B', branch, 'origin/staging'], { cwd, stdio: 'inherit' });
  return { branch, stagingBaseSha };
}

export function checkoutWorkerBranch(branch: string, cwd = root): void {
  execFileSync('git', ['checkout', branch], { cwd, stdio: 'inherit' });
}

export function resetRunState(state: State, processAlive = defaultProcessAlive): State {
  if (isActiveStatus(state.status) && state.workerPid && processAlive(state.workerPid))
    throw new Error(`cannot reset while Worker process ${state.workerPid} is still running`);
  return {
    completedIssues: state.completedIssues ?? [],
    stagingGreen: state.stagingGreen,
    drainStatus: 'running',
    updatedAt: Date.now(),
  };
}

function argumentValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++)
    if (args[index] === flag && args[index + 1] && !args[index + 1].startsWith('--'))
      values.push(args[index + 1]);
  return values;
}

function activeRunForHitl(state: State): Required<Pick<State, 'issue' | 'pr'>> & State {
  if (state.status !== 'review_cap_pending' || !state.issue || !state.pr)
    throw new Error(
      'HITL resolution requires one active run in review_cap_pending with an existing PR',
    );
  return state as Required<Pick<State, 'issue' | 'pr'>> & State;
}

function hitlComment(state: State, action: string): string {
  const cap = state.reviewCap!;
  return `[HITL Review Cap] action=${action} issue=#${state.issue} pr=#${state.pr} round=${state.reviewRound} sha=${cap.decisionSha ?? 'unknown'} waived=${cap.waivedFindingIds.join(',') || 'none'} additionalRounds=${cap.additionalRounds} steer=${cap.steer}`;
}

function publishHitlDecision(state: State, action: string): void {
  const body = hitlComment(state, action);
  commentIssueOnce(state.issue!, body);
  commentPullRequestOnce(state.pr!, body);
}

function prHealthyForHumanMerge(pr: PullRequest, cfg: Config): boolean {
  const checks = pr.statusCheckRollup ?? [];
  return (
    pr.mergeable?.toUpperCase() !== 'CONFLICTING' &&
    pr.mergeStateStatus?.toUpperCase() !== 'DIRTY' &&
    (cfg.requiredPrChecks ?? ['pr-checks']).every((name) => {
      const check = checks.find((candidate) => candidate.name === name);
      return Boolean(check && normalizeCheckStatus(check).passed);
    })
  );
}

function resolveReviewCap(args: string[], cfg: Config): void {
  const stored = readState();
  const steer = argumentValues(args, '--steer').at(-1)?.trim();
  if (!steer) throw new Error('--resolve-review-cap requires --steer <text>');
  const abandon = args.includes('--abandon');
  const waiveAll = args.includes('--waive-all-outstanding');
  const waived = argumentValues(args, '--waive').flatMap((value) => value.split(','));
  const additionalRaw = argumentValues(args, '--additional-rounds').at(-1);
  const additionalRounds = additionalRaw === undefined ? 0 : Number(additionalRaw);
  if (!Number.isInteger(additionalRounds) || additionalRounds < 0)
    throw new Error('--additional-rounds must be a non-negative integer');
  if (abandon && (waiveAll || waived.length || additionalRounds))
    throw new Error('--abandon cannot be combined with waivers or additional rounds');
  if (!abandon && !waiveAll && !waived.length && additionalRounds === 0)
    throw new Error('choose --additional-rounds, --waive, --waive-all-outstanding, or --abandon');

  if (abandon) {
    if (
      !stored.issue ||
      !stored.pr ||
      !['review_cap_pending', 'abandon_pending'].includes(stored.status ?? '')
    )
      throw new Error('abandonment requires the active review-cap run or its pending abandonment');
    let state: State = {
      ...stored,
      status: 'abandon_pending',
      abandonment: { ...stored.abandonment, steer },
    };
    writeState(state);
    if (!state.abandonment?.commentPublished) {
      publishHitlDecision(state, 'abandon');
      state = { ...state, abandonment: { ...state.abandonment!, commentPublished: true } };
      writeState(state);
    }
    if (!state.abandonment?.prClosed) {
      gh(['pr', 'close', String(state.pr)]);
      state = { ...state, abandonment: { ...state.abandonment!, prClosed: true } };
      writeState(state);
    }
    if (!state.abandonment?.labelled) {
      gh(['issue', 'edit', String(state.issue), '--add-label', 'wontfix']);
      state = { ...state, abandonment: { ...state.abandonment!, labelled: true } };
      writeState(state);
    }
    if (!state.abandonment?.issueClosed) {
      gh(['issue', 'close', String(state.issue)]);
      state = { ...state, abandonment: { ...state.abandonment!, issueClosed: true } };
      writeState(state);
    }
    writeState({
      ...state,
      status: 'abandoned',
    });
    return;
  }

  const current = activeRunForHitl(stored);

  const outstanding = new Set(current.reviewCap?.outstandingFindingIds ?? []);
  const normalizedWaivers = waiveAll
    ? [...outstanding]
    : [...new Set(waived.map((id) => id.toUpperCase()))];
  if (normalizedWaivers.some((id) => !outstanding.has(id)))
    throw new Error(
      `waivers must name outstanding findings: ${[...outstanding].join(', ') || 'none'}`,
    );
  const cap = {
    ...current.reviewCap!,
    additionalRounds: (current.reviewCap?.additionalRounds ?? 0) + additionalRounds,
    waivedFindingIds: [
      ...new Set([...(current.reviewCap?.waivedFindingIds ?? []), ...normalizedWaivers]),
    ],
    steer,
    resolvedBy: gh(['api', 'user', '--jq', '.login']),
    resolvedAt: new Date().toISOString(),
  };
  const allWaived = cap.outstandingFindingIds.every((id) => cap.waivedFindingIds.includes(id));
  if (additionalRounds === 0 && !allWaived)
    throw new Error('findings remain; waive them explicitly or grant additional rounds');
  const pr = pullRequest(current.pr);
  if (additionalRounds === 0 && !prHealthyForHumanMerge(pr, cfg))
    throw new Error(
      'PR must have green required checks and be clean/mergeable before a no-round waiver',
    );
  const next: State = {
    ...current,
    reviewCap: cap,
    status: additionalRounds > 0 ? 'worker_recovery_pending' : 'ready_for_human_merge',
    lastError: undefined,
    lastErrorVerbose: undefined,
    updatedAt: Date.now(),
  };
  writeState(next);
  publishHitlDecision(next, additionalRounds > 0 ? 'resume' : 'waive_ready_for_human_merge');
}

function linkIssueToActiveRun(issue: number): void {
  if (!Number.isInteger(issue) || issue <= 0)
    throw new Error('--link-issue requires a positive issue number');
  const current = readState();
  if (!current.issue || !current.pr)
    throw new Error('--link-issue requires one active run with an existing PR');
  gh(['issue', 'view', String(issue), '--json', 'number,state']);
  const linkedClosingIssues = [...new Set([...(current.linkedClosingIssues ?? []), issue])].filter(
    (number) => number !== current.issue,
  );
  const next = { ...current, linkedClosingIssues, updatedAt: Date.now() };
  writeState(next);
  const body = pullRequestBody(current.pr);
  const normalized = withIssueClosingReference(body, current.issue, linkedClosingIssues);
  if (normalized !== body.trim()) updatePullRequestBody(current.pr, normalized);
  const note = `[Sloop linked issue] PR #${current.pr} closes #${current.issue} and #${issue} when a human merges to staging.`;
  commentIssueOnce(current.issue, note);
  commentIssueOnce(issue, note);
  commentPullRequestOnce(current.pr, note);
}

export function acquire(d: Deps, ttl: number): string {
  const token = randomUUID();
  const lock = dispatcherLockPath(d.root);
  mkdirSync(join(lock, '..'), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      mkdirSync(lock);
      writeState({ pid: d.pid(), createdAt: d.now(), token } as any, join(lock, 'owner.json'));
      return token;
    } catch {
      const owner = join(lock, 'owner.json');
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
  if (cfg.baseBranch !== undefined && cfg.baseBranch !== 'staging')
    throw new Error(`Worker PR baseBranch must be staging; found ${cfg.baseBranch}`);
  const initial = d.load();
  const recovery =
    initial.status === 'worker_recovery_pending' ||
    isStaleWorker(initial, cfg, d) ||
    (initial.status === 'blocked' && hasPersistedRecoveryContext(initial));
  if (isActiveStatus(initial.status) && !recovery)
    throw new Error(`active run exists for issue #${initial.issue}`);
  const lockToken = acquire(d, cfg.lockTtlMs ?? 900000);
  try {
    if (!cfg.workerCommand || !cfg.staffReviewCommand || !cfg.qaCommand)
      throw new Error('workerCommand, staffReviewCommand and qaCommand are required');
    const processed = new Set<number>(d.load().completedIssues ?? []);
    const existingIssue = recovery || isActiveStatus(d.load().status) ? d.load().issue : undefined;
    d.save({ ...d.load(), drainStatus: 'running' });
    while (true) {
      const issue = existingIssue
        ? d.eligible().find((candidate) => candidate.number === existingIssue)
        : d.eligible().find((candidate) => !processed.has(candidate.number));
      if (!issue) {
        if (existingIssue) throw new Error(`issue #${existingIssue} is not eligible for recovery`);
        d.save({
          completedIssues: d.load().completedIssues ?? [],
          stagingGreen: d.load().stagingGreen,
          status: 'done',
          drainStatus: 'done',
          updatedAt: d.now(),
        });
        return;
      }
      processed.add(issue.number);
      try {
        if (recovery) {
          const persisted = d.load().branch;
          const expected = workerBranchName(issue.number);
          if (persisted !== expected)
            throw new Error(
              `recovery requires persisted worker branch ${expected}; found ${persisted ?? 'none'}`,
            );
          (d.checkoutWorkerBranch ?? ((branch) => checkoutWorkerBranch(branch, d.root)))(persisted);
          status(d, issue.number, 'worker_recovery_pending', {
            pr: d.load().pr,
            workerRecoveryCount: d.load().workerRecoveryCount ?? 0,
          });
          d.comment(
            issue.number,
            'Dispatcher detectó un Worker perdido y levantará una ejecución de recovery.',
          );
        } else {
          claimNewIssue(d, issue.number);
          d.comment(issue.number, 'Dispatcher reclama esta issue de forma exclusiva.');
          const prepared = (d.prepareWorkerBranch ?? ((number) => prepareWorkerBranch(number)))(
            issue.number,
          );
          d.save({
            ...d.load(),
            branch: prepared.branch,
            stagingBaseSha: prepared.stagingBaseSha,
          });
        }
        await processIssue(cfg, d, issue);
        // Temporarily process exactly one issue per invocation. This prevents
        // state from one completed issue leaking into the next issue while the
        // dispatcher transition logic is being hardened.
        return;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[sloop] issue #${issue.number} bloqueada: ${message}`);
        const current = d.load();
        const preserveRecovery =
          isWorkerStatus(current.status) ||
          current.status === 'worker_recovery_pending' ||
          hasPersistedRecoveryContext(current);
        status(d, issue.number, preserveRecovery ? 'worker_recovery_pending' : 'blocked', {
          lastError: message,
          pr: current.pr,
        });
        return;
      }
    }
  } finally {
    const owner = join(dispatcherLockPath(d.root), 'owner.json');
    try {
      if (JSON.parse(readFileSync(owner, 'utf8')).token === lockToken)
        rmSync(dispatcherLockPath(d.root), { recursive: true, force: true });
    } catch {
      /* lock already recovered */
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    const current = readState();
    const displayed = args.includes('--verbose')
      ? current
      : Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'lastErrorVerbose'));
    console.log(JSON.stringify(displayed, null, 2));
    return;
  }
  if (args.includes('--verbose')) throw new Error('--verbose is supported only with --status');
  const cfg: Config = existsSync(join(root, 'sloop.config.json'))
    ? JSON.parse(readFileSync(join(root, 'sloop.config.json'), 'utf8'))
    : {};
  if (args.includes('--list')) {
    console.log(JSON.stringify(eligible(), null, 2));
    return;
  }
  if (args.includes('--recover-lock')) {
    console.log(recoverStaleLock(root));
    return;
  }
  if (args.includes('--reset')) {
    const state = readState();
    writeState(resetRunState(state));
    console.log('Estado local del sloop reiniciado. Ejecutá npm run sloop.');
    return;
  }
  if (args.includes('--resolve-review-cap')) {
    resolveReviewCap(args, cfg);
    console.log('Resolución HITL registrada.');
    return;
  }
  const linkIssueIndex = args.indexOf('--link-issue');
  if (linkIssueIndex >= 0) {
    linkIssueToActiveRun(Number(args[linkIssueIndex + 1]));
    console.log(`Issue #${args[linkIssueIndex + 1]} vinculada al PR activo.`);
    return;
  }
  const recoveryIndex = args.indexOf('--prepare-recovery');
  if (recoveryIndex >= 0) {
    const issue = Number(args[recoveryIndex + 1]);
    const prIndex = args.indexOf('--pr');
    const pr = prIndex >= 0 ? Number(args[prIndex + 1]) : readState().pr;
    if (!Number.isInteger(issue) || issue < 1)
      throw new Error('--prepare-recovery requires an issue number');
    if (!pr || !Number.isInteger(pr))
      throw new Error('--prepare-recovery requires --pr or an existing state.pr');
    writeState(prepareRecovery(readState(), issue, pr, Date.now(), cfg.workerLeaseMs ?? 900000));
    console.log(`Recovery preparado para issue #${issue}, PR #${pr}. Ejecutá npm run sloop.`);
    return;
  }
  await dispatch(cfg, {
    root,
    load: () => readState(),
    save: writeState,
    eligible,
    comment: (i, body) => gh(['issue', 'comment', String(i), '--body', body]),
    run: runCommand,
    pullRequest,
    prComment: commentPullRequest,
    now: Date.now,
    pid: () => process.pid,
    processAlive: defaultProcessAlive,
  });
}

if (process.argv[1]?.endsWith('dispatcher.js'))
  void main().catch((e) => {
    console.error(`[dispatcher] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
