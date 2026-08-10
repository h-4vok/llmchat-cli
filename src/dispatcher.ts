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
import {
  validateEnvelope,
  parseDelimitedEnvelope,
  envelopeHash,
  Envelope,
  ReviewerOutput,
  WorkerOutput,
  EnvelopeValidationContext,
} from './agent-output.js';
import {
  loadPublicationState,
  savePublicationState,
  recordEnvelope,
} from './publication-ledger.js';
import { buildDiffIndex, DiffLine, publishArtifact } from './review-publication.js';

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
  /** Structured role results and publication data are retained for recovery. */
  agentEnvelopes?: Record<string, Envelope>;
  humanFeedback?: Record<string, unknown>;
  humanFeedbackBaseline?: Record<string, { updated_at?: string; created_at?: string }>;
  publicationLedger?: Record<string, unknown>;
};

export type Check = {
  name: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
};

export type Review = {
  id?: string;
  body?: string;
  commitId?: string;
  submittedAt?: string;
  updatedAt?: string;
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
  comments?: Array<{
    id?: string;
    body?: string;
    source?: 'pull_request' | 'issue' | 'review' | 'thread';
    inReplyToId?: string;
    createdAt?: string;
    updatedAt?: string;
    url?: string;
    author?: string;
  }>;
  statusCheckRollup?: Check[];
};

type Command = string[] | { command: string; args: string[]; timeoutMs?: number; retries?: number };
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
  logRoleInvocation?: boolean;
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
  issueComments?: (issue: number) => Array<{
    id?: string;
    body?: string;
    createdAt?: string;
    updatedAt?: string;
    url?: string;
    author?: string;
  }>;
  now: () => number;
  pid: () => number;
  processAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onReclaim?: () => void;
  prepareWorkerBranch?: (issue: number) => { branch: string; stagingBaseSha: string };
  checkoutWorkerBranch?: (branch: string) => void;
  updatePullRequestBody?: (pr: number, body: string) => void | Promise<void>;
  pullRequestBody?: (pr: number) => string | Promise<string>;
  prComment?: (pr: number, body: string) => void | string | Promise<void | string>;
  prInlineComment?: (
    pr: number,
    body: string,
    payload: Record<string, unknown>,
  ) => void | string | Promise<void | string>;
  prReply?: (pr: number, commentId: string, body: string) => void | string | Promise<void | string>;
  prResolve?: (pr: number, commentId: string) => void | Promise<void>;
  prReact?: (pr: number, commentId: string, reaction: string) => void | Promise<void>;
  reviewDiff?: (pr: number, commit: string) => DiffLine[];
};
type Spec = {
  command: string;
  args: string[];
  timeoutMs: number;
  retries: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  logInvocation?: boolean;
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

function issueComments(issue: number) {
  const repo = ghJson<{ nameWithOwner: string }>([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
  ]).nameWithOwner;
  const pages = ghJson<any[]>([
    'api',
    `repos/${repo}/issues/${issue}/comments`,
    '--paginate',
    '--slurp',
  ]);
  return pages.flat().map((comment: any) => ({
    id: comment.id ? String(comment.id) : undefined,
    body: comment.body,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    url: comment.html_url,
    author: comment.user?.login,
  }));
}

function pullRequest(pr: number): PullRequest {
  const raw = ghJson<any>([
    'pr',
    'view',
    String(pr),
    '--json',
    'number,state,baseRefName,headRefName,headRefOid,body,mergeStateStatus,mergeable,reviews,comments,statusCheckRollup',
  ]);
  const repo = ghJson<{ nameWithOwner: string }>([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
  ]).nameWithOwner;
  const issueCommentPages = ghJson<any[]>([
    'api',
    `repos/${repo}/issues/${pr}/comments`,
    '--paginate',
    '--slurp',
  ]);
  const reviewCommentPages = ghJson<any[]>([
    'api',
    `repos/${repo}/pulls/${pr}/comments`,
    '--paginate',
    '--slurp',
  ]);
  const issueComments = issueCommentPages.flat();
  const reviewComments = reviewCommentPages.flat();
  const conversation = [
    ...(raw.comments ?? []).map((comment: any) => ({ ...comment, source: 'issue' })),
    ...issueComments.map((comment: any) => ({ ...comment, source: 'issue' })),
    ...reviewComments.map((comment: any) => ({
      ...comment,
      source: comment.in_reply_to_id ? 'thread' : 'review',
    })),
  ];
  const seen = new Set<string>();
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
      id: review.id ? String(review.id) : undefined,
      body: review.body,
      state: review.state,
      submittedAt: review.submittedAt ?? review.submitted_at,
      updatedAt: review.updatedAt ?? review.updated_at,
      commitId: review.commit?.oid ?? review.commitId ?? review.commit_id,
    })),
    comments: conversation
      .map((comment: any) => ({
        id: comment.id ? String(comment.id) : undefined,
        body: comment.body,
        source: comment.source,
        inReplyToId: comment.in_reply_to_id ? String(comment.in_reply_to_id) : undefined,
        createdAt: comment.createdAt ?? comment.created_at,
        updatedAt: comment.updatedAt ?? comment.updated_at,
        url: comment.url ?? comment.html_url,
        author: comment.author?.login ?? comment.user?.login,
      }))
      .filter((comment: { id?: string }) => {
        if (!comment.id || seen.has(comment.id)) return false;
        seen.add(comment.id);
        return true;
      }),
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

function commentPullRequest(pr: number, body: string): string {
  return gh(['pr', 'comment', String(pr), '--body', body]);
}

function repositoryName(): string {
  return ghJson<{ nameWithOwner: string }>(['repo', 'view', '--json', 'nameWithOwner'])
    .nameWithOwner;
}

export function githubReplyRequest(
  repo: string,
  pr: number,
  commentId: string,
  body: string,
): string[] {
  return [
    'api',
    `repos/${repo}/pulls/${pr}/comments`,
    '--method',
    'POST',
    '-f',
    `body=${body}`,
    '-F',
    `in_reply_to=${commentId}`,
  ];
}

export function githubReactionRequest(repo: string, commentId: string, reaction: string): string[] {
  return [
    'api',
    `repos/${repo}/issues/comments/${commentId}/reactions`,
    '--method',
    'POST',
    '-f',
    `content=${reaction}`,
  ];
}

export function githubReviewThreadLookupRequest(repo: string, pr: number): string[] {
  const [owner, name] = repo.split('/', 2);
  return [
    'api',
    'graphql',
    '-f',
    'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id comments(first:100){nodes{databaseId}}}}}}}',
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${pr}`,
  ];
}

export function githubResolveReviewThreadRequest(threadId: string): string[] {
  return [
    'api',
    'graphql',
    '-f',
    'query=mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}',
    '-f',
    `threadId=${threadId}`,
  ];
}

function replyPullRequest(pr: number, commentId: string, body: string): string {
  const repo = repositoryName();
  const result = ghJson<{ id?: number; html_url?: string }>(
    githubReplyRequest(repo, pr, commentId, body),
  );
  return result.html_url ?? (result.id ? String(result.id) : '');
}

function resolvePullRequestThread(pr: number, commentId: string): void {
  const repo = repositoryName();
  const lookup = ghJson<{
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              id: string;
              comments?: { nodes?: Array<{ databaseId?: number | null }> };
            }>;
          };
        };
      };
    };
  }>(githubReviewThreadLookupRequest(repo, pr));
  const thread = lookup.data?.repository?.pullRequest?.reviewThreads?.nodes?.find((node) =>
    node.comments?.nodes?.some((comment) => String(comment.databaseId) === String(commentId)),
  );
  if (!thread) throw new Error(`review thread not found for comment ${commentId}`);
  gh(githubResolveReviewThreadRequest(thread.id));
}

function reactToPullRequestComment(pr: number, commentId: string, reaction: string): void {
  const repo = repositoryName();
  gh(githubReactionRequest(repo, commentId, reaction));
}

function inlineCommentPullRequest(
  pr: number,
  body: string,
  payload: Record<string, unknown>,
): string {
  const repo = ghJson<{ nameWithOwner: string }>([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
  ]).nameWithOwner;
  const args = [
    'api',
    `repos/${repo}/pulls/${pr}/comments`,
    '--method',
    'POST',
    '-f',
    `body=${body}`,
  ];
  for (const [key, value] of Object.entries(payload)) args.push('-f', `${key}=${String(value)}`);
  const result = ghJson<{ id?: number; html_url?: string }>(args);
  return result.html_url ?? (result.id ? String(result.id) : '');
}

function localReviewDiff(commit: string): DiffLine[] {
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', '--unified=0', `origin/staging...${commit}`], {
      cwd: root,
      encoding: 'utf8',
    });
  } catch {
    return [];
  }
  const lines: DiffLine[] = [];
  let path = '';
  for (const line of diff.split(/\r?\n/)) {
    const file = line.match(/^\+\+\+ b\/(.+)$/);
    if (file) {
      path = file[1];
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk || !path) continue;
    const oldStart = Number(hunk[1]);
    const oldCount = Number(hunk[2] ?? 1);
    const newStart = Number(hunk[3]);
    const newCount = Number(hunk[4] ?? 1);
    for (let i = 0; i < newCount; i++) lines.push({ path, side: 'RIGHT', line: newStart + i });
    for (let i = 0; i < oldCount; i++) lines.push({ path, side: 'LEFT', line: oldStart + i });
  }
  return lines;
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
  if (!Array.isArray(value)) {
    if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string'))
      throw new Error(
        'commands must provide args as a string array; migrate each role command to { command, args, timeoutMs, retries }',
      );
  }
  return {
    command: Array.isArray(value) ? value[0] : value.command,
    args: Array.isArray(value) ? value.slice(1) : value.args,
    timeoutMs: Array.isArray(value) ? 120000 : (value.timeoutMs ?? 120000),
    retries: Array.isArray(value) ? 0 : (value.retries ?? 0),
    logInvocation: undefined,
  };
}

export function runCommand(spec: Spec | undefined): Promise<string> {
  if (!spec) return Promise.resolve('');
  const executable = resolveExecutable(spec.command);
  const launch = childProcessInvocation(executable, spec.args);
  const attempt = (n: number, failedAttempts: string[] = []): Promise<string> =>
    new Promise((resolve, reject) => {
      console.error(
        ...(spec.logInvocation === false
          ? []
          : [
              `[sloop] ejecutando (${n + 1}/${spec.retries + 1}): ${spec.command} ${spec.args.join(' ')}`,
            ]),
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
  const credentialKey = String.raw`(?:[A-Za-z][A-Za-z0-9_-]*[-_])?(?:token|api[_-]?key|secret|password|cookie|credentials?)(?:[-_][A-Za-z0-9_-]*)?`;
  const sensitiveKey = String.raw`(?:authorization|${credentialKey})`;
  const assignedSecret = new RegExp(
    String.raw`((?:["']${sensitiveKey}["']|${sensitiveKey})\s*[:=]\s*)(?!(?:\[REDACTED\])(?=$|[\s,;\]}]))(?:Bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)`,
    'gi',
  );
  return value
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/@]*@/gi, '$1[REDACTED]@')
    .replace(assignedSecret, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:proxy-)?authorization\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/\b((?:set-)?cookie\s*:\s*)[^\r\n]*/gi, '$1[REDACTED]')
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
  const baseline = Object.fromEntries(
    (d.issueComments?.(issue) ?? [])
      .filter((comment) => comment.id)
      .map((comment) => [
        String(comment.id),
        { updated_at: comment.updatedAt, created_at: comment.createdAt },
      ]),
  );
  d.save({
    completedIssues: current.completedIssues ?? [],
    stagingGreen: current.stagingGreen,
    issue,
    status: 'claimed',
    reviewRound: 1,
    drainStatus: 'running',
    ...(Object.keys(baseline).length ? { humanFeedbackBaseline: baseline } : {}),
    updatedAt: d.now(),
  });
  console.error(`[sloop] issue #${issue}: claimed`);
  d.comment(
    issue,
    `Sloop engineering v2: estado claimed. Skill activa: ${skillFor('claimed')}. QA precede a Staff; no se hace merge automÃ¡tico.`,
  );
}

async function establishFeedbackBaseline(d: Deps, issue: number, pr?: number): Promise<void> {
  const baseline = { ...(d.load().humanFeedbackBaseline ?? {}) };
  for (const comment of d.issueComments?.(issue) ?? []) {
    if (comment.id)
      baseline[String(comment.id)] = {
        updated_at: comment.updatedAt,
        created_at: comment.createdAt,
      };
  }
  if (pr && d.pullRequest) {
    const current = await d.pullRequest(pr);
    for (const comment of current.comments ?? []) {
      if (comment.id)
        baseline[String(comment.id)] = {
          updated_at: comment.updatedAt,
          created_at: comment.createdAt,
        };
    }
    for (const review of current.reviews ?? []) {
      if (review.id)
        baseline[String(review.id)] = {
          updated_at: review.updatedAt,
          created_at: review.submittedAt,
        };
    }
  }
  d.save({ ...d.load(), humanFeedbackBaseline: baseline });
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
    return `Use the worker skill for GitHub issue #${issue.number}: ${issue.title}. This is dispatcher recovery run ${runId}, review round ${round}. Continue the existing task in the current checkout. ${pr ? `An existing PR is #${pr}; update that PR and never create a second PR.` : 'Create exactly one PR targeting staging if one does not exist.'} Do not merge. The claimed issue number is ${issue.number} (also in LLMCHAT_ISSUE_NUMBER). The dispatcher has generated the initial PR body in LLMCHAT_PR_BODY: ${JSON.stringify(initialPrBody ?? '')}. If creating a PR, pass that exact value to gh pr create using --body-file (or an equivalent file-based body argument); do not construct the closing reference yourself. When updating the PR, preserve every state-authorized closing reference supplied in the recovery context exactly once; do not add or remove other issue links without dispatcher instruction. Use gh pr create/edit (or equivalent) to persist that body. Inspect the issue, current PR diff, CI checks, mergeability, and all [QA/SDET Review] and [Staff Review] feedback. If the PR is CONFLICTING or DIRTY against staging, update the branch from staging, resolve every conflict, run the required checks, and do not report ready_for_review until the PR is clean and mergeable. Resolve every actionable finding. Do not publish GitHub review, evidence, or Worker comments: return exactly one llmchat.agent-output/v1 envelope as your final result; the dispatcher owns all publication. Include the structured human-verification guide in that envelope. Never delete or modify .llmchat/state.json or dispatcher runtime state. Exit 0 only after the work, conflict resolution, and PR update are complete; do not return Markdown evidence. Issue body:\n${issueContext}\n${context ? `Recovered context:\n${context}\n` : ''}${feedback ? `Actionable feedback to resolve:\n${feedback}\n` : ''}`;
  if (role === 'qa')
    return `Use the qa-sdet skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against staging before Staff. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Inspect the acceptance criteria, diff, CI check results, regression coverage, and smoke evidence. Do not publish directly to GitHub. Return exactly one llmchat.agent-output/v1 envelope using the supplied reviewer schema, with typed findings, notes, summary, evidence, and dispositions. Do not edit code or merge. Exit 0 after returning the structured envelope. Issue body:\n${issueContext}`;
  return `Use the staff-reviewer skill for GitHub issue #${issue.number}: ${issue.title}. Review PR #${pr} against staging after QA has passed. Current head is ${headSha ?? 'unknown'} and this is review round ${round}. Perform the independent adversarial review for design, security, regressions, boundaries, and abuse cases. Do not publish directly to GitHub. Return exactly one llmchat.agent-output/v1 envelope using the supplied reviewer schema, with typed findings, notes, summary, evidence, and dispositions. Do not edit code or merge. Exit 0 after returning the structured envelope. Issue body:\n${issueContext}`;
}

function roleCommand(value: Command | undefined, issue: number, cfg: Config): Spec | undefined {
  const spec = command(value, issue);
  if (!spec) return undefined;
  if (Array.isArray(value))
    throw new Error(
      'role commands must be { command, args, timeoutMs, retries }; migrate each role command from argv arrays',
    );
  if (/^(?:.*[\\/])?codex(?:\.cmd|\.exe)?$/i.test(spec.command) && spec.args[0] === 'exec') {
    const sandboxIndexes = spec.args.reduce<number[]>(
      (indexes, arg, index) => (arg === '--sandbox' ? [...indexes, index] : indexes),
      [],
    );
    if (
      sandboxIndexes.length !== 1 ||
      !['read-only', 'workspace-write', 'danger-full-access'].includes(
        spec.args[sandboxIndexes[0] + 1] ?? '',
      )
    )
      throw new Error(
        `${spec.command} exec must include exactly one valid --sandbox in args; migrate each role command and remove legacy codexSandbox`,
      );
  }
  return { ...spec, logInvocation: cfg.logRoleInvocation !== false };
}

function structuredRoleSpec(spec: Spec, role: 'worker' | 'qa' | 'staff', runId: string): Spec {
  if (!/^(?:.*[\\/])?codex(?:\.cmd|\.exe)?$/i.test(spec.command) || spec.args[0] !== 'exec')
    return spec;
  const runDir = join(root, '.llmchat', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const schema = join(
    root,
    'schemas',
    role === 'worker' ? 'worker-agent-output-v1.json' : 'reviewer-agent-output-v1.json',
  );
  const lastMessage = join(runDir, `${role}.json`);
  const has = (flag: string) => spec.args.includes(flag);
  const structuredFlags = [
    ...(has('--output-schema') ? [] : ['--output-schema', schema]),
    ...(has('--output-last-message') ? [] : ['--output-last-message', lastMessage]),
  ];
  return { ...spec, args: [spec.args[0], ...structuredFlags, ...spec.args.slice(1)] };
}

function readStructuredOutput(
  runId: string,
  role: 'worker' | 'qa' | 'staff',
  context: EnvelopeValidationContext = {},
  stream = '',
): Envelope | undefined {
  const file = join(root, '.llmchat', 'runs', runId, `${role}.json`);
  if (!existsSync(file)) {
    if (!stream || !stream.includes('<<<llmchat.agent-output/v1>>>')) return undefined;
    return parseDelimitedEnvelope(stream, { ...context, role });
  }
  const raw = readFileSync(file, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return parseDelimitedEnvelope(raw, { ...context, role });
  }
  return validateEnvelope(value, { ...context, role });
}

function findingState(state: State, role?: 'worker' | 'qa' | 'staff'): EnvelopeValidationContext {
  const allocated = new Set<string>();
  const latestDisposition = new Map<string, string>();
  for (const envelope of Object.values(state.agentEnvelopes ?? {})) {
    const output = envelope.output as ReviewerOutput;
    if (!('artifacts' in output)) continue;
    for (const artifact of output.artifacts) {
      if (artifact.schema === 'review.finding/v1' && artifact.id) {
        allocated.add(artifact.id);
        if (output.dispositions[artifact.id])
          latestDisposition.set(artifact.id, output.dispositions[artifact.id]);
      }
    }
    for (const [id, disposition] of Object.entries(output.dispositions)) {
      if (id.match(/^[QS]\d+$/)) {
        allocated.add(id);
        latestDisposition.set(id, disposition);
      }
    }
  }
  const open = [...allocated].filter((id) => latestDisposition.get(id) !== 'resolve');
  const openHumanFeedbackIds = Object.entries(state.humanFeedback ?? {})
    .filter(
      ([, value]) =>
        (value as any)?.status !== 'withdrawn' && (value as any)?.status !== 'resolved',
    )
    .map(([id]) => id)
    .filter((id) => /^H\d+$/.test(id));
  return {
    allocatedFindingIds: [...allocated],
    openFindingIds: [...open],
    openHumanFeedbackIds,
    ...(role ? { role } : {}),
  };
}

function retainEnvelope(d: Deps, envelope: Envelope): void {
  const state = d.load();
  const envelopes = { ...(state.agentEnvelopes ?? {}), [envelope.message_id]: envelope };
  const output = envelope.output as ReviewerOutput | WorkerOutput;
  const artifacts = 'artifacts' in output ? output.artifacts : [];
  const ledger = { ...(state.publicationLedger ?? {}) };
  for (const artifact of artifacts) {
    const id = artifact.id ?? `${artifact.schema}:${artifact.body}`;
    const key = `${envelope.message_id}:${id}`;
    ledger[key] ??= {
      key,
      envelope: envelope.message_id,
      artifact,
      status: 'pending',
      intendedPlacement: artifact.placement?.kind ?? 'general',
      envelope_hash: envelopeHash(envelope),
      source_id: artifact.schema === 'review.finding/v1' ? artifact.id : undefined,
      context_cursor: envelope.context.feedback_cursor,
      intended_action: artifact.placement?.kind === 'inline' ? 'inline' : 'general',
    };
  }
  d.save({ ...state, agentEnvelopes: envelopes, publicationLedger: ledger });
}

function workerMetadata(output: string, knownPr?: number): { pr?: number; base?: string } {
  const match = output.match(/^\s*WORKER_RESULT\s+pr=(\d+)\s+base=([^\s]+)\s*$/im);
  if (match) return { pr: Number(match[1]), base: match[2] };
  if (knownPr) return { pr: knownPr, base: 'staging' };
  throw new Error('Worker must exit 0 and print WORKER_RESULT pr=<number> base=staging');
}

const publicationMarker = '<!-- llmchat-review-publish:v1';
const workerPublicationMarker = '<!-- llmchat-worker-publish:v1';
function humanFeedbackCursor(state: State): string {
  const items = Object.values(state.humanFeedback ?? {})
    .map((item: any) => `${item.id}:${item.context_cursor ?? ''}:${item.status ?? ''}`)
    .sort()
    .join('|');
  return createHash('sha256').update(items).digest('hex');
}

function ingestHumanFeedback(d: Deps, pr: PullRequest, issue?: number): void {
  const state = d.load();
  const feedback = { ...(state.humanFeedback ?? {}) } as Record<string, any>;
  const baseline = state.humanFeedbackBaseline ?? {};
  let next =
    Object.keys(feedback)
      .filter((id) => /^H\d+$/.test(id))
      .reduce((n, id) => Math.max(n, Number(id.slice(1))), 0) + 1;
  const seenRemoteIds = new Set<string>();
  const conversation = [
    ...(issue
      ? (d.issueComments?.(issue) ?? []).map((comment) => ({
          ...comment,
          source: 'issue' as const,
          inReplyToId: undefined,
        }))
      : []),
    ...(pr.comments ?? []),
    ...(pr.reviews ?? []).map((review) => ({
      id: review.id,
      body: review.body,
      source: 'review' as const,
      inReplyToId: undefined,
      createdAt: review.submittedAt,
      updatedAt: review.updatedAt ?? review.submittedAt,
    })),
  ];
  for (const comment of conversation) {
    if (
      !comment.id ||
      !comment.body ||
      comment.body.includes(publicationMarker) ||
      comment.body.startsWith('[Worker]') ||
      comment.body.startsWith('[QA/SDET Review]') ||
      comment.body.startsWith('[Staff Review]')
    )
      continue;
    seenRemoteIds.add(comment.id);
    const baselineItem = baseline[comment.id];
    if (
      baselineItem &&
      (comment.updatedAt ?? comment.createdAt ?? '') <=
        (baselineItem.updated_at ?? baselineItem.created_at ?? '')
    )
      continue;
    const existing = Object.values(feedback).find(
      (item: any) => item.remote_id === comment.id,
    ) as any;
    if (existing) {
      if (existing.body !== comment.body || existing.updated_at !== comment.updatedAt) {
        existing.revisions = [
          ...(existing.revisions ?? []),
          { body: comment.body, updated_at: comment.updatedAt },
        ];
        existing.body = comment.body;
        existing.updated_at = comment.updatedAt;
        existing.context_cursor = `${comment.id}:${comment.updatedAt ?? comment.createdAt ?? ''}`;
      }
      continue;
    }
    const id = `H${next++}`;
    feedback[id] = {
      id,
      remote_id: comment.id,
      body: comment.body,
      source: comment.source ?? 'pull_request',
      in_reply_to_id: comment.inReplyToId,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
      context_cursor: `${comment.id}:${comment.updatedAt ?? comment.createdAt ?? ''}`,
      status: 'open',
    };
    void Promise.resolve(d.prReact?.(pr.number, comment.id, 'eyes')).catch(() => undefined);
  }
  for (const [id, item] of Object.entries(feedback)) {
    const existing = item as any;
    if (
      existing.remote_id &&
      !seenRemoteIds.has(String(existing.remote_id)) &&
      existing.status !== 'withdrawn'
    ) {
      existing.status = 'withdrawn';
      existing.withdrawn_at = new Date(d.now()).toISOString();
      existing.context_cursor = `${existing.remote_id}:withdrawn:${existing.withdrawn_at}`;
    }
  }
  d.save({ ...state, humanFeedback: feedback });
}

async function publishStructuredWorkerOutput(
  d: Deps,
  pr: number,
  round: number,
  envelope: Envelope,
  output: WorkerOutput,
): Promise<void> {
  if (!d.prComment) throw new Error('dispatcher PR publication adapter is required');
  const key = createHash('sha256')
    .update(`${envelope.message_id}:worker:${round}:${envelope.context.commit}`)
    .digest('hex')
    .slice(0, 32);
  const body = [
    `[Worker] round=${round} status=${output.status} pr=${pr} base=staging commit=${envelope.context.commit}`,
    `${workerPublicationMarker} key=${key} -->`,
    output.evidence.map((item) => `- ${item}`).join('\n'),
    '[Human Verification]',
    '```json',
    JSON.stringify(output.human_verification, null, 2),
    '```',
  ].join('\n\n');
  const state = d.load();
  const ledger = { ...(state.publicationLedger ?? {}) } as Record<string, any>;
  const existing = ledger[key];
  if (existing?.status === 'published' || existing?.status === 'resolved') return;
  ledger[key] = {
    ...(existing ?? {}),
    key,
    action: 'worker-evidence',
    placement: 'general',
    status: 'pending',
    marker: `${workerPublicationMarker} key=${key} -->`,
    run: envelope.context.run_id,
    role: 'worker',
    round,
    commit: envelope.context.commit,
    artifact: body,
    context_cursor: envelope.context.feedback_cursor,
    envelope_hash: envelopeHash(envelope),
    artifact_hash: createHash('sha256').update(body).digest('hex'),
    intended_action: 'general',
  };
  d.save({ ...d.load(), publicationLedger: ledger });
  const current = d.pullRequest ? await d.pullRequest(pr) : undefined;
  if (
    current?.comments?.some((comment) =>
      comment.body?.includes(`${workerPublicationMarker} key=${key}`),
    )
  ) {
    ledger[key].status = 'published';
    d.save({ ...d.load(), publicationLedger: ledger });
    return;
  }
  const remote = await d.prComment(pr, body);
  if (remote) ledger[key].remote_id = String(remote);
  ledger[key].status = 'published';
  d.save({ ...d.load(), publicationLedger: ledger });
}

async function publishStaleWorkerOutput(
  d: Deps,
  pr: number,
  round: number,
  envelope: Envelope,
  output: WorkerOutput,
  currentCommit: string | undefined,
): Promise<void> {
  if (!d.prComment) throw new Error('dispatcher PR publication adapter is required');
  const key = createHash('sha256')
    .update(`${envelope.message_id}:worker-stale-context:${round}:${envelope.context.commit}`)
    .digest('hex')
    .slice(0, 32);
  const marker = `${workerPublicationMarker} key=${key} -->`;
  const body = [
    `[Worker] round=${round} stale_context commit=${envelope.context.commit} current_commit=${currentCommit ?? 'unknown'}`,
    marker,
    'This structured Worker result is informational only because the PR head or human-feedback context changed while the Worker was running. It was not used to advance the sloop.',
    output.evidence.map((item) => `- ${item}`).join('\n'),
    '[Human Verification]',
    '```json',
    JSON.stringify(output.human_verification, null, 2),
    '```',
  ].join('\n\n');
  const state = d.load();
  const ledger = { ...(state.publicationLedger ?? {}) } as Record<string, any>;
  const existing = ledger[key];
  if (existing?.status === 'published') return;
  ledger[key] = {
    ...(existing ?? {}),
    key,
    action: 'worker-stale-context',
    placement: 'general',
    status: 'pending',
    marker,
    run: envelope.context.run_id,
    role: 'worker',
    round,
    commit: envelope.context.commit,
    current_commit: currentCommit,
    artifact: body,
    context_cursor: envelope.context.feedback_cursor,
    envelope_hash: envelopeHash(envelope),
    artifact_hash: createHash('sha256').update(body).digest('hex'),
    intended_action: 'general',
  };
  d.save({ ...d.load(), publicationLedger: ledger });
  const current = d.pullRequest ? await d.pullRequest(pr) : undefined;
  if (current?.comments?.some((comment) => comment.body?.includes(marker))) {
    ledger[key].status = 'published';
    d.save({ ...d.load(), publicationLedger: ledger });
    return;
  }
  const remote = await d.prComment(pr, body);
  if (remote) ledger[key].remote_id = String(remote);
  ledger[key].status = 'published';
  d.save({ ...d.load(), publicationLedger: ledger });
}

function openFindingIds(state: State, role: 'qa' | 'staff'): string[] {
  const prefix = role === 'qa' ? 'Q' : 'S';
  const ids = new Set<string>();
  for (const envelope of Object.values(state.agentEnvelopes ?? {})) {
    const output = envelope.output as ReviewerOutput;
    if (!('artifacts' in output)) continue;
    for (const artifact of output.artifacts)
      if (
        artifact.schema === 'review.finding/v1' &&
        artifact.id?.startsWith(prefix) &&
        output.dispositions[artifact.id] !== 'resolve'
      )
        ids.add(artifact.id);
    for (const [id, disposition] of Object.entries(output.dispositions))
      if (id.startsWith(prefix) && disposition !== 'resolve') ids.add(id);
  }
  return [...ids];
}

async function dispatchWorkerResolutions(d: Deps, pr: number, output: WorkerOutput): Promise<void> {
  const state = d.load();
  const ledger = { ...(state.publicationLedger ?? {}) } as Record<string, any>;
  for (const resolution of output.resolutions) {
    const source = Object.values(ledger).find(
      (entry: any) => entry.source_id === resolution.finding_id,
    ) as any;
    if (!source || source.resolution_status === resolution.status) continue;
    const body = `[Worker] ref=${resolution.finding_id} status=${resolution.status}\n${resolution.response}`;
    source.resolution_status = resolution.status;
    source.resolution_body = body;
    source.resolution_action =
      source.intended_action === 'inline' && source.remote_id ? 'reply' : 'general';
    d.save({ ...d.load(), publicationLedger: ledger });
    if (source.resolution_action === 'reply' && d.prReply)
      source.resolution_remote_id = String(await d.prReply(pr, source.remote_id, body));
    else if (d.prComment) source.resolution_remote_id = String(await d.prComment(pr, body));
    source.resolution_published = true;
    d.save({ ...d.load(), publicationLedger: ledger });
  }
}

async function dispatchReviewerDispositions(
  d: Deps,
  pr: number,
  role: 'qa' | 'staff',
  dispositions: Record<string, 'continue' | 'resolve'>,
): Promise<void> {
  const state = d.load();
  const ledger = { ...(state.publicationLedger ?? {}) } as Record<string, any>;
  for (const [id, disposition] of Object.entries(dispositions)) {
    if (disposition !== 'resolve') continue;
    if (role === 'qa' && !id.startsWith('Q')) throw new Error(`QA cannot resolve ${id}`);
    if (role === 'staff' && !/^[SH]\d+$/.test(id)) throw new Error(`Staff cannot resolve ${id}`);
    const source = Object.values(ledger).find((entry: any) => entry.source_id === id) as any;
    if (id.startsWith('H') && !source) {
      const feedback = d.load().humanFeedback?.[id] as any;
      if (feedback?.remote_id && d.prComment)
        await d.prComment(pr, `[Staff Review] resolution ref=${id} disposition=resolve`);
      if (feedback) {
        const humanFeedback = { ...(d.load().humanFeedback ?? {}) } as Record<string, any>;
        humanFeedback[id] = { ...feedback, status: 'resolved' };
        d.save({ ...d.load(), humanFeedback });
      }
      continue;
    }
    if (!source || source.status === 'resolved') continue;
    const body = `[${role === 'qa' ? 'QA/SDET' : 'Staff'} Review] resolution ref=${id} disposition=resolve`;
    if (source.intended_action === 'inline' && source.remote_id && d.prResolve)
      await d.prResolve(pr, source.remote_id);
    else if (d.prComment) await d.prComment(pr, body);
    source.status = 'resolved';
    source.resolved_by = role;
    source.resolution_action =
      source.intended_action === 'inline' ? 'resolve_thread' : 'general_resolution';
    d.save({ ...d.load(), publicationLedger: ledger });
    if (id.startsWith('H') && d.load().humanFeedback?.[id]) {
      const humanFeedback = { ...(d.load().humanFeedback ?? {}) } as Record<string, any>;
      humanFeedback[id] = { ...humanFeedback[id], status: 'resolved' };
      d.save({ ...d.load(), humanFeedback });
    }
  }
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
      (typeof value === 'string' && value.trim()) ||
      (Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === 'string' && item.trim()));
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
    return {
      ...guide,
      steps: typeof guide.steps === 'string' ? [guide.steps] : guide.steps,
      expected: typeof guide.expected === 'string' ? [guide.expected] : guide.expected,
      limitations: typeof guide.limitations === 'string' ? [guide.limitations] : guide.limitations,
      checklist: typeof guide.checklist === 'string' ? [guide.checklist] : guide.checklist,
    } as HumanReviewGuide;
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
  // The persisted head is the claim-time snapshot for a resumed PR. Fresh
  // claims have no prior head yet; the post-run fetch below still reconciles
  // the newly-created/updated PR before accepting structured output.
  const before = pr && d.pullRequest && d.load().headSha ? await d.pullRequest(pr) : undefined;
  if (before && d.pullRequest) ingestHumanFeedback(d, before, issue.number);
  const feedbackCursorBefore = humanFeedbackCursor(d.load());
  const initialPrBody = withIssueClosingReference(
    '',
    issue.number,
    d.load().linkedClosingIssues ?? [],
  );
  const output = await d.run(
    withWorkerLifecycle(
      d,
      structuredRoleSpec(
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
        'worker',
        runId,
      ),
      issue.number,
      runId,
    ),
  );
  const structured = readStructuredOutput(
    runId,
    'worker',
    {
      ...findingState(d.load(), 'worker'),
      run_id: runId,
      issue: issue.number,
      round,
    },
    output,
  );
  if (structured) {
    retainEnvelope(d, structured);
    const payload = structured.output as WorkerOutput;
    if (payload.status === 'blocked') throw new Error('Worker returned blocked structured output');
  }
  const metadata = structured
    ? { pr: structured.context.pr, base: 'staging' }
    : workerMetadata(output, pr);
  if (!metadata.pr || metadata.base !== (cfg.baseBranch ?? 'staging'))
    throw new Error('Worker must report an existing PR based on staging');
  if (!d.pullRequest) throw new Error('GitHub PR evidence adapter is required');
  const after = structured ? await d.pullRequest(metadata.pr) : undefined;
  if (after) ingestHumanFeedback(d, after, issue.number);
  const feedbackCursorAfter = humanFeedbackCursor(d.load());
  if (
    structured &&
    after &&
    (structured.context.commit !== after.headRefOid || feedbackCursorAfter !== feedbackCursorBefore)
  ) {
    await publishStaleWorkerOutput(
      d,
      metadata.pr,
      round,
      structured,
      structured.output as WorkerOutput,
      after.headRefOid,
    );
    const currentFeedback = [
      feedback,
      ...Object.values(d.load().humanFeedback ?? {})
        .filter((item: any) => item.status !== 'withdrawn' && item.status !== 'resolved')
        .map((item: any) => `[${item.id}] ${item.body}`),
    ]
      .filter(Boolean)
      .join('\n\n');
    return runWorker(cfg, d, issue, round, metadata.pr, context, currentFeedback);
  }
  const currentBody = await (d.pullRequestBody ?? pullRequestBody)(metadata.pr);
  const normalizedBody = withIssueClosingReference(
    currentBody,
    issue.number,
    d.load().linkedClosingIssues ?? [],
  );
  if (normalizedBody !== currentBody.trim())
    await (d.updatePullRequestBody ?? updatePullRequestBody)(metadata.pr, normalizedBody);
  if (structured)
    await publishStructuredWorkerOutput(
      d,
      metadata.pr,
      round,
      structured,
      structured.output as WorkerOutput,
    );
  d.save({ ...d.load(), pr: metadata.pr, workerPid: undefined, workerHeartbeatAt: d.now() });
  const evidence = structured
    ? await d.pullRequest(metadata.pr)
    : await waitForEvidence(d, cfg, metadata.pr, (candidate) => {
        const head = candidate.headRefOid;
        return Boolean(latestWorkerComment(candidate, round, head));
      });
  if (!structured && !latestWorkerComment(evidence, round, evidence.headRefOid))
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
  if (structured)
    await dispatchWorkerResolutions(d, metadata.pr, structured.output as WorkerOutput);
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
  const commit = evidence.headRefOid;
  if (!commit) throw new Error('review requires a current PR head SHA');
  if (!configured) throw new Error(`${role} command is required`);
  const spec = roleCommand(configured, issue.number, cfg);
  if (!spec) throw new Error(`${role} command is required`);
  const runId = d.load().workerRunId ?? randomUUID();
  if (d.pullRequest) ingestHumanFeedback(d, await d.pullRequest(prNumber), issue.number);
  const feedbackCursorBefore = humanFeedbackCursor(d.load());
  const output = await d.run(
    structuredRoleSpec(
      {
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
      },
      role,
      runId,
    ),
  );
  const structured = readStructuredOutput(
    runId,
    role,
    {
      ...findingState(d.load(), role),
      run_id: runId,
      issue: issue.number,
      pr: prNumber,
      round,
      commit,
    },
    output,
  );
  if (structured) {
    const current = d.pullRequest ? await d.pullRequest(prNumber) : evidence;
    if (d.pullRequest) ingestHumanFeedback(d, current, issue.number);
    const feedbackCursorAfter = humanFeedbackCursor(d.load());
    if (current.headRefOid !== commit || feedbackCursorAfter !== feedbackCursorBefore) {
      const stalePayload = structured.output as ReviewerOutput;
      const staleKey = createHash('sha256')
        .update(`${structured.message_id}:stale_context:${commit}`)
        .digest('hex')
        .slice(0, 32);
      const staleBody = [
        `${marker} round=${round} stale_context commit=${commit} current_commit=${current.headRefOid ?? 'unknown'}`,
        `<!-- llmchat-review-publish:v1 key=${staleKey} -->`,
        'This structured review result is informational only because the PR head or human-feedback context changed while the review was running.',
        stalePayload.summary,
        ...stalePayload.evidence.map((item) => `- ${item}`),
        ...stalePayload.artifacts.map(
          (artifact) => `- [${artifact.id ?? 'note'}] ${artifact.body}`,
        ),
      ].join('\n\n');
      if (d.prComment) {
        const ledger = { ...(d.load().publicationLedger ?? {}) } as Record<string, any>;
        if (!ledger[staleKey]) {
          ledger[staleKey] = {
            key: staleKey,
            status: 'pending',
            action: 'stale_context',
            placement: 'general',
            artifact: staleBody,
            envelope_hash: envelopeHash(structured),
            context_cursor: structured.context.feedback_cursor,
          };
          d.save({ ...d.load(), publicationLedger: ledger });
          await d.prComment(prNumber, staleBody);
          ledger[staleKey].status = 'published';
          d.save({ ...d.load(), publicationLedger: ledger });
        }
      }
      return runReview(cfg, d, issue, role, prNumber, round, current);
    }
    retainEnvelope(d, structured);
    const payload = structured.output as ReviewerOutput;
    if (payload.result === 'blocked') throw new Error(`${role} returned blocked structured output`);
    const reviewMarker = role === 'qa' ? '[QA/SDET Review]' : '[Staff Review]';
    const verdict =
      role === 'qa'
        ? payload.result === 'accepted'
          ? 'passed'
          : 'changes_requested'
        : payload.result === 'accepted'
          ? 'approved'
          : 'changes_requested';
    if (!d.prComment) throw new Error('dispatcher PR publication adapter is required');
    const diffIndex = buildDiffIndex(d.reviewDiff?.(prNumber, commit) ?? localReviewDiff(commit));
    const ledger = { ...(d.load().publicationLedger ?? {}) } as Record<string, any>;
    const publish = async (
      publication: ReturnType<typeof publishArtifact>,
      action: string,
      inline = false,
      sourceId?: string,
    ) => {
      const existing = ledger[publication.key];
      if (
        existing?.status === 'published' ||
        existing?.status === 'fallback' ||
        existing?.status === 'resolved'
      )
        return;
      ledger[publication.key] = {
        ...(existing ?? {}),
        key: publication.key,
        action,
        placement: publication.kind,
        status: 'pending',
        marker: publication.body.split('\n')[0],
        run: runId,
        role,
        round,
        commit,
        artifact: publication.body,
        fallback_reason: publication.fallbackReason,
        source_id: sourceId,
        context_cursor: structured.context.feedback_cursor,
        envelope_hash: envelopeHash(structured),
        artifact_hash: createHash('sha256').update(publication.body).digest('hex'),
        intended_action: publication.kind === 'inline' ? 'inline' : 'general',
      };
      d.save({ ...d.load(), publicationLedger: ledger });
      const current = d.pullRequest ? await d.pullRequest(prNumber) : undefined;
      if (
        current?.comments?.some((comment) =>
          comment.body?.includes(publication.body.split('\n')[0]),
        )
      ) {
        ledger[publication.key].status = publication.fallbackReason ? 'fallback' : 'published';
        d.save({ ...d.load(), publicationLedger: ledger });
        return;
      }
      try {
        const remote =
          inline && publication.kind === 'inline' && publication.payload && d.prInlineComment
            ? await d.prInlineComment(prNumber, publication.body, publication.payload)
            : await d.prComment!(prNumber, publication.body);
        if (remote) {
          ledger[publication.key].remote_id = String(remote);
          ledger[publication.key].url = String(remote).startsWith('http')
            ? String(remote)
            : undefined;
        }
        ledger[publication.key].status = publication.fallbackReason ? 'fallback' : 'published';
        d.save({ ...d.load(), publicationLedger: ledger });
      } catch (error) {
        if (inline && publication.kind === 'inline') {
          const fallback = {
            ...publication,
            kind: 'general' as const,
            fallbackReason: `inline publication failed: ${error instanceof Error ? error.message : String(error)}`,
          };
          await publish(fallback, 'general-fallback', false, sourceId);
          return;
        }
        ledger[publication.key].status = 'failed';
        d.save({ ...d.load(), publicationLedger: ledger });
        throw error;
      }
    };
    const header = {
      schema: 'review.summary/v1' as const,
      id: `${role}-summary`,
      body: `${reviewMarker} round=${round} verdict=${verdict} commit=${commit}\n\n${payload.summary}\n\n${payload.evidence.map((item) => `- ${item}`).join('\n')}`,
    };
    await publish(publishArtifact(header, { runId, role, round, commit }, diffIndex), 'general');
    for (const artifact of payload.artifacts) {
      const publication = publishArtifact(artifact, { runId, role, round, commit }, diffIndex);
      await publish(
        publication,
        publication.kind === 'inline' ? 'inline' : 'general',
        publication.kind === 'inline',
        artifact.id,
      );
    }
    await dispatchReviewerDispositions(d, prNumber, role, payload.dispositions);
    const body = [
      `${reviewMarker} round=${round} verdict=${verdict} commit=${evidence.headRefOid}`,
      payload.summary,
      ...payload.evidence.map((item) => `- ${item}`),
      ...payload.artifacts.map((artifact) => `- [${artifact.id ?? 'note'}] ${artifact.body}`),
    ].join('\n\n');
    const refreshed = d.pullRequest ? await d.pullRequest(prNumber) : evidence;
    return { verdict, body, evidence: refreshed };
  }
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
  if ('codexSandbox' in (cfg as Record<string, unknown>))
    throw new Error(
      'codexSandbox is no longer supported; configure --sandbox in each role command args',
    );
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
    roleCommand(cfg.workerCommand, 0, cfg);
    roleCommand(cfg.qaCommand, 0, cfg);
    roleCommand(cfg.staffReviewCommand, 0, cfg);
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
          await establishFeedbackBaseline(d, issue.number, d.load().pr);
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
    const supportedStatusArgs =
      (args.length === 1 && args[0] === '--status') ||
      (args.length === 2 && args.includes('--verbose'));
    if (!supportedStatusArgs) throw new Error('--status accepts only the optional --verbose flag');
    const current = readState();
    const displayed = args.includes('--verbose')
      ? current
      : {
          issue: current.issue,
          pr: current.pr,
          status: current.status,
          lastError: current.lastError,
        };
    console.log(JSON.stringify(displayed, null, 2));
    return;
  }
  if (args.includes('--verbose')) throw new Error('--verbose is supported only with --status');
  const cfg: Config = existsSync(join(root, 'sloop.config.json'))
    ? JSON.parse(readFileSync(join(root, 'sloop.config.json'), 'utf8'))
    : {};
  if (args.includes('--list')) {
    const listedIssues = eligible().map(({ number, title }) => ({ number, title }));
    console.log(JSON.stringify(listedIssues, null, 2));
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
    issueComments,
    comment: (i, body) => gh(['issue', 'comment', String(i), '--body', body]),
    run: runCommand,
    pullRequest,
    prComment: commentPullRequest,
    prInlineComment: inlineCommentPullRequest,
    prReply: replyPullRequest,
    prResolve: resolvePullRequestThread,
    prReact: reactToPullRequestComment,
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
