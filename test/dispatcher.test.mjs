import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  acquire,
  command,
  dispatcherLockPath,
  dispatch,
  prepareWorkerBranch,
  prepareRecovery,
  redactDiagnostic,
  recoverStaleLock,
  workerBranchName,
  resetRunState,
  runCommand,
} from '../dist/dispatcher.js';

const baseConfig = {
  baseBranch: 'staging',
  workerCommand: ['codex', 'exec'],
  staffReviewCommand: ['codex', 'exec'],
  qaCommand: ['codex', 'exec'],
  requiredPrChecks: ['pr-checks'],
  checkPollIntervalMs: 0,
  checkTimeoutMs: 1000,
  evidencePollIntervalMs: 0,
  evidenceTimeoutMs: 1000,
  workerLeaseMs: 100,
  maxReviewRounds: 5,
};

test('redactDiagnostic preserves diagnostic context without credential values', () => {
  const diagnostic =
    'exit 2\nAuthorization: Bearer secret-value\nTOKEN=abc123\ncookie=session-value\nhttps://example.test/log';
  const redacted = redactDiagnostic(diagnostic);
  assert.match(redacted, /exit 2/);
  assert.match(redacted, /https:\/\/example\.test\/log/);
  assert.doesNotMatch(redacted, /secret-value|abc123|session-value/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('redactDiagnostic redacts JSON secrets and prefixed environment credentials', () => {
  const diagnostic =
    '{"token":"json-secret","password":"p@ss"}\nGITHUB_TOKEN=env-secret\nSERVICE_API_KEY="api-secret"';
  const redacted = redactDiagnostic(diagnostic);
  assert.doesNotMatch(redacted, /json-secret|p@ss|env-secret|api-secret/);
  assert.match(redacted, /token["']?\s*:\s*\[REDACTED\]/i);
  assert.match(redacted, /GITHUB_TOKEN=\[REDACTED\]/);
  assert.match(redacted, /SERVICE_API_KEY=\[REDACTED\]/);
});

function harness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-'));
  let state = overrides.initialState ?? {};
  const saves = [];
  const comments = [];
  const runs = [];
  const reviews = [];
  const pr = {
    number: 14,
    state: 'OPEN',
    baseRefName: 'staging',
    headRefName: overrides.headRefName ?? 'codex/issue-1',
    headRefOid: 'abc0',
    mergeStateStatus: 'CLEAN',
    mergeable: 'MERGEABLE',
    comments: [],
    reviews,
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  let workerCount = 0;
  let qaCount = 0;
  let staffCount = 0;
  const qaVerdicts = overrides.qaVerdicts ?? ['passed'];
  const staffVerdicts = overrides.staffVerdicts ?? ['approved'];
  const publishEvidence = {
    worker: true,
    qa: true,
    staff: true,
    ...(overrides.publishEvidence ?? {}),
  };
  const checkSequences = overrides.checkSequences ?? [pr.statusCheckRollup];
  let checkIndex = 0;

  const roleOf = (spec) => {
    if (spec.input?.includes('Use the worker skill')) return 'worker';
    if (spec.input?.includes('Use the qa-sdet skill')) return 'qa';
    if (spec.input?.includes('Use the staff-reviewer skill')) return 'staff';
    return 'unknown';
  };

  const deps = {
    root,
    load: () => state,
    save: (next) => {
      saves.push(structuredClone(next));
      state = next;
    },
    eligible: () => issues,
    comment: (issue, body) => comments.push([issue, body]),
    run: async (spec) => {
      runs.push(spec);
      const role = roleOf(spec);
      const round = Number(spec.input?.match(/review round (\d+)/)?.[1] ?? 1);
      if (role === 'worker') {
        workerCount += 1;
        pr.headRefOid = `abc${workerCount}`;
        spec.onStart?.(1000 + workerCount);
        spec.onHeartbeat?.();
        if (publishEvidence.worker)
          pr.comments.push({
            body: `[Worker] round=${round} status=ready_for_review pr=${pr.number} base=staging commit=${pr.headRefOid}`,
            createdAt: `${workerCount}`,
          });
        return `WORKER_RESULT pr=${pr.number} base=staging`;
      }
      if (role === 'qa') {
        qaCount += 1;
        const verdict = qaVerdicts[qaCount - 1] ?? qaVerdicts.at(-1);
        if (publishEvidence.qa)
          reviews.push({
            body: `[QA/SDET Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,
            commitId: pr.headRefOid,
            submittedAt: `${qaCount}`,
          });
        return 'QA completed';
      }
      if (role === 'staff') {
        staffCount += 1;
        const verdict = staffVerdicts[staffCount - 1] ?? staffVerdicts.at(-1);
        if (publishEvidence.staff)
          reviews.push({
            body: `[Staff Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,
            commitId: pr.headRefOid,
            submittedAt: `${staffCount}`,
          });
        return 'Staff completed';
      }
      return 'completed';
    },
    pullRequest: () => {
      pr.statusCheckRollup = checkSequences[Math.min(checkIndex++, checkSequences.length - 1)];
      return structuredClone(pr);
    },
    now: () => Date.now(),
    pid: () => process.pid,
    processAlive: (pid) => pid > 0 && pid !== -1,
    sleep: async () => {},
    prepareWorkerBranch: (issue) => ({
      branch: workerBranchName(issue),
      stagingBaseSha: 'staging-sha-1',
    }),
  };

  return {
    root,
    comments,
    runs,
    reviews,
    saves,
    deps,
    state: () => state,
    setState: (next) => {
      state = next;
    },
    counts: () => ({ workerCount, qaCount, staffCount }),
    cfg: { ...baseConfig, ...overrides.config },
  };
}

test('commands use argv, exit codes, retries, timeout and no shell contract', async () => {
  assert.deepEqual(command(['node', '-e', 'process.exit(0)'], 42, true).args, [
    '-e',
    'process.exit(0)',
  ]);
  assert.throws(() => command({ command: 'node; malicious' }, 1), /shell operators/);
  await assert.rejects(
    runCommand(command({ command: 'node', args: ['-e', 'process.exit(2)'], retries: 1 }, 0)),
    /failed after 2 attempt/,
  );
  await assert.rejects(
    runCommand(
      command(
        {
          command: 'node',
          args: [
            '-e',
            "console.log('stdout detail'); console.error('stderr detail'); process.exit(2)",
          ],
        },
        0,
      ),
    ),
    /stdout:\nstdout detail[\s\S]*stderr:\nstderr detail/,
  );
  await assert.rejects(
    () =>
      runCommand(
        command({ command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'], timeoutMs: 10 }, 0),
      ),
    /failed/,
  );
});

test('dispatcher runs Worker, QA, then Staff and uses PR evidence instead of JSON', async () => {
  const h = harness();
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.deepEqual(h.counts(), { workerCount: 1, qaCount: 1, staffCount: 1 });
  assert.deepEqual(
    h.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'qa-sdet', 'staff-reviewer'],
  );
  assert.deepEqual(
    h.runs.map((run) => run.args.slice(-2)),
    [
      ['--sandbox', 'read-only'],
      ['--sandbox', 'read-only'],
      ['--sandbox', 'read-only'],
    ],
  );
  assert.equal(h.reviews[0].body.startsWith('[QA/SDET Review]'), true);
  assert.equal(h.reviews[1].body.startsWith('[Staff Review]'), true);
  assert.equal(h.state().branch, 'codex/issue-1');
  assert.equal(h.state().stagingBaseSha, 'staging-sha-1');
});

test('worker branch convention is deterministic and rejects invalid issue numbers', () => {
  assert.equal(workerBranchName(16), 'codex/issue-16');
  assert.throws(() => workerBranchName(0), /issue number must be positive/);
});

test('new branch preparation refuses to overwrite an existing worker branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-git-'));
  const remote = mkdtempSync(join(tmpdir(), 'llmchat-remote-'));
  const runGit = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  runGit(['init', '-b', 'staging']);
  runGit(['config', 'user.email', 'test@example.com']);
  runGit(['config', 'user.name', 'Test']);
  writeFileSync(join(root, 'README.md'), 'staging');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'initial']);
  const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
  assert.equal(remoteResult.status, 0, remoteResult.stderr);
  runGit(['remote', 'add', 'origin', remote]);
  runGit(['push', 'origin', 'staging']);
  runGit(['branch', 'codex/issue-1']);
  assert.throws(
    () => prepareWorkerBranch(1, root),
    /worker branch codex\/issue-1 already exists; refusing to overwrite it/,
  );
  assert.equal(runGit(['rev-parse', 'codex/issue-1']), runGit(['rev-parse', 'HEAD']));
  rmSync(root, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

test('new branch preparation uses staging updated by fetch', () => {
  const seed = mkdtempSync(join(tmpdir(), 'llmchat-seed-'));
  const remote = mkdtempSync(join(tmpdir(), 'llmchat-remote-'));
  const work = mkdtempSync(join(tmpdir(), 'llmchat-work-'));
  const runGit = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    runGit(seed, ['init', '-b', 'staging']);
    runGit(seed, ['config', 'user.email', 'test@example.com']);
    runGit(seed, ['config', 'user.name', 'Test']);
    writeFileSync(join(seed, 'README.md'), 'initial');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'initial']);
    const remoteResult = spawnSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
    assert.equal(remoteResult.status, 0, remoteResult.stderr);
    runGit(seed, ['remote', 'add', 'origin', remote]);
    runGit(seed, ['push', 'origin', 'staging']);
    runGit(work, ['clone', remote, '.']);
    writeFileSync(join(seed, 'README.md'), 'updated staging');
    runGit(seed, ['add', 'README.md']);
    runGit(seed, ['commit', '-m', 'advance staging']);
    const updatedStagingSha = runGit(seed, ['rev-parse', 'HEAD']);
    runGit(seed, ['push', 'origin', 'staging']);

    const prepared = prepareWorkerBranch(16, work);

    assert.equal(prepared.branch, 'codex/issue-16');
    assert.equal(prepared.stagingBaseSha, updatedStagingSha);
    assert.equal(runGit(work, ['rev-parse', 'codex/issue-16']), updatedStagingSha);
  } finally {
    rmSync(seed, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test('dispatcher rejects a PR whose worker branch violates the convention', async () => {
  const h = harness([{ number: 1, title: 'branch validation' }], {
    headRefName: 'codex/other-branch',
  });
  await dispatch(h.cfg, h.deps);
  assert.match(
    h.state().lastError,
    /must use worker branch codex\/issue-1; found codex\/other-branch/,
  );
});

test('dispatcher rejects a configurable non-staging PR base explicitly', async () => {
  const h = harness();
  await assert.rejects(
    () => dispatch({ ...h.cfg, baseBranch: 'main' }, h.deps),
    /Worker PR baseBranch must be staging; found main/,
  );
  assert.equal(h.runs.length, 0);
});

test('dispatcher stops after one issue instead of draining the queue', async () => {
  const h = harness([
    { number: 1, title: 'first' },
    { number: 2, title: 'second' },
  ]);
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.deepEqual(h.counts(), { workerCount: 1, qaCount: 1, staffCount: 1 });
  assert.deepEqual(h.state().completedIssues, [1]);
});

test('new issue claim clears the completed issue PR context before validation', async () => {
  const h = harness(
    [
      { number: 16, title: 'completed' },
      { number: 17, title: 'next issue', body: 'new acceptance criteria' },
    ],
    {
      headRefName: 'codex/issue-17',
      initialState: {
        issue: 16,
        status: 'ready_for_human_merge',
        pr: 16,
        branch: 'codex/issue-16',
        headSha: 'old-head',
        stagingBaseSha: 'old-staging',
        reviewRound: 9,
        lastCiFeedback: 'old CI feedback',
        lastQaFeedback: 'old QA feedback',
        lastStaffFeedback: 'old Staff feedback',
        taskContext: 'old task context',
        workerRunId: 'old-run',
        workerPid: 123,
        workerStartedAt: 1,
        workerHeartbeatAt: 1,
        workerRecoveryCount: 4,
        lastError: 'old error',
        completedIssues: [16],
        stagingGreen: true,
      },
    },
  );
  const validatedPrs = [];
  const pullRequest = h.deps.pullRequest;
  h.deps.pullRequest = (pr) => {
    validatedPrs.push(pr);
    return pullRequest(pr);
  };

  await dispatch(h.cfg, h.deps);

  const claimSave = h.saves.find((saved) => saved.status === 'claimed');
  assert.deepEqual(claimSave, {
    completedIssues: [16],
    stagingGreen: true,
    issue: 17,
    status: 'claimed',
    reviewRound: 1,
    drainStatus: 'running',
    updatedAt: claimSave.updatedAt,
  });
  assert.equal(h.runs[0].input.includes('An existing PR is #16'), false);
  assert.equal(h.runs[0].input.includes('old task context'), false);
  assert.equal(h.state().branch, 'codex/issue-17');
  assert.equal(h.state().pr, 14);
  assert.equal(validatedPrs.length > 0, true);
  assert.equal(
    validatedPrs.every((pr) => pr === 14),
    true,
  );
  assert.deepEqual(h.state().completedIssues, [16, 17]);
  assert.equal(h.state().stagingGreen, true);
});

test('QA changes return to Worker and QA is repeated before Staff', async () => {
  const h = harness([{ number: 1, title: 'a' }], { qaVerdicts: ['changes_requested', 'passed'] });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.deepEqual(h.counts(), { workerCount: 2, qaCount: 2, staffCount: 1 });
  assert.deepEqual(
    h.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'qa-sdet', 'worker', 'qa-sdet', 'staff-reviewer'],
  );
});

test('Staff changes return to Worker and force QA before Staff re-review', async () => {
  const h = harness([{ number: 1, title: 'a' }], {
    staffVerdicts: ['changes_requested', 'approved'],
  });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.deepEqual(h.counts(), { workerCount: 2, qaCount: 2, staffCount: 2 });
  assert.deepEqual(
    h.runs.map((run) => run.input?.match(/Use the ([^ ]+)/)?.[1]),
    ['worker', 'qa-sdet', 'staff-reviewer', 'worker', 'qa-sdet', 'staff-reviewer'],
  );
});

test('recovery detects stale Worker state, starts a new Worker and reuses the existing PR', async () => {
  const now = Date.now();
  const h = harness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      now,
      100,
    ),
  });
  h.deps.prepareWorkerBranch = () => {
    throw new Error('recovery must reuse the existing branch');
  };
  let checkedOut;
  h.deps.checkoutWorkerBranch = (branch) => {
    checkedOut = branch;
  };
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.equal(h.state().pr, 14);
  assert.equal(checkedOut, 'codex/issue-1');
  assert.equal(h.counts().workerCount, 1);
  assert.equal(
    h.comments.some(([, body]) => body.includes('Worker perdido')),
    true,
  );
});

test('new branch preparation failure is persisted and does not leave a claimed run stuck', async () => {
  const h = harness([{ number: 1, title: 'a' }]);
  h.deps.prepareWorkerBranch = () => {
    throw new Error('fetch failed');
  };
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'blocked');
  assert.match(h.state().lastError, /The loop stopped during blocked/);
  assert.equal(h.state().lastErrorVerbose, 'fetch failed');
});

test('blocked issue with PR context enters recovery instead of a fresh claim', async () => {
  const h = harness([{ number: 1, title: 'recover me' }], {
    initialState: {
      issue: 1,
      status: 'blocked',
      pr: 14,
      branch: 'codex/issue-1',
      headSha: 'old-head',
      reviewRound: 3,
      lastQaFeedback: 'actionable QA finding',
    },
  });
  h.deps.prepareWorkerBranch = () => {
    throw new Error('fresh claim path must not run');
  };
  h.deps.checkoutWorkerBranch = () => {};
  await dispatch(h.cfg, h.deps);
  assert.equal(h.runs[0].input.includes('An existing PR is #14'), true);
  assert.equal(h.runs[0].input.includes('actionable QA finding'), true);
  assert.equal(h.state().status, 'ready_for_human_merge');
});

test('recovery rejects a non-deterministic persisted branch', async () => {
  const h = harness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery({ completedIssues: [1], branch: 'main' }, 1, 14, Date.now(), 100),
  });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'worker_recovery_pending');
  assert.match(h.state().lastError, /recovery requires persisted worker branch codex\/issue-1/);
});

test('conflicting Worker PR is rejected before reviews', async () => {
  const h = harness([{ number: 1, title: 'a' }]);
  h.deps.pullRequest = () => ({
    number: 14,
    state: 'OPEN',
    baseRefName: 'staging',
    headRefName: 'codex/issue-1',
    headRefOid: 'abc1',
    mergeStateStatus: 'DIRTY',
    mergeable: 'CONFLICTING',
    comments: [{ body: '[Worker] round=1 status=ready_for_review pr=14 base=staging commit=abc1' }],
    reviews: [],
    statusCheckRollup: [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.counts().qaCount, 0);
  assert.equal(h.state().status, 'worker_recovery_pending');
  assert.match(h.state().lastError, /remains conflicting or dirty/);
});

test('failed PR CI returns the issue to a recovered Worker without local npm gates', async () => {
  const h = harness([{ number: 1, title: 'a' }], {
    checkSequences: [
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'FAILURE' }],
      [{ name: 'pr-checks', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ],
  });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.equal(h.counts().workerCount, 2);
  assert.equal(
    h.runs.some((run) => run.command === 'npm'),
    false,
  );
});

test('successful role process without a published review blocks the dispatcher', async () => {
  const h = harness([{ number: 1, title: 'a' }], { publishEvidence: { staff: false } });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'worker_recovery_pending');
  assert.match(h.state().lastError, /did not publish \[Staff Review\]/);
});

test('active live run remains exclusive while stale recovery is allowed', async () => {
  const h = harness([{ number: 1, title: 'a' }], {
    initialState: {
      issue: 1,
      status: 'worker_running',
      workerPid: process.pid,
      workerHeartbeatAt: Date.now(),
    },
  });
  await assert.rejects(() => dispatch(h.cfg, h.deps), /active run exists/);
});

test('stale locks recover safely and reclaim markers are atomic', () => {
  const h = harness();
  const lock = dispatcherLockPath(h.root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), '{stale');
  const first = acquire(h.deps, 1);
  assert.match(first, /^[0-9a-f-]+$/);
  assert.throws(() => acquire(h.deps, 1), /already running/);
  rmSync(lock, { recursive: true, force: true });
});

test('status remains observable while an active task is stored', () => {
  const h = harness();
  mkdirSync(join(h.root, '.llmchat'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'state.json'),
    JSON.stringify({ issue: 9, status: 'worker_running' }),
  );
  const status = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'dispatcher.js'), '--status'],
    {
      cwd: h.root,
      encoding: 'utf8',
    },
  );
  assert.equal(status.status, 0);
  assert.match(status.stdout, /worker_running/);
});

test('prepareRecovery preserves PR and removes only the issue from completion', () => {
  const state = prepareRecovery(
    {
      pr: 15,
      branch: 'codex/issue-1',
      headSha: 'head-15',
      stagingBaseSha: 'staging-10',
      reviewRound: 4,
      lastQaFeedback: 'fix the boundary case',
      taskContext: 'recovered task context',
      completedIssues: [1, 2],
      status: 'done',
    },
    1,
    15,
    1000,
    100,
  );
  assert.equal(state.pr, 15);
  assert.equal(state.status, 'worker_running');
  assert.deepEqual(state.completedIssues, [2]);
  assert.equal(state.workerPid, -1);
  assert.equal(state.workerHeartbeatAt, 899);
  assert.equal(state.reviewRound, 4);
  assert.equal(state.lastQaFeedback, 'fix the boundary case');
  assert.equal(state.taskContext, 'recovered task context');
  assert.equal(state.headSha, 'head-15');
});

test('no-work done state clears all prior run context', async () => {
  const h = harness([], {
    initialState: {
      issue: 9,
      status: 'blocked',
      pr: 14,
      branch: 'codex/issue-9',
      headSha: 'old-head',
      stagingBaseSha: 'old-staging',
      reviewRound: 4,
      lastCiFeedback: 'old CI',
      lastQaFeedback: 'old QA',
      lastStaffFeedback: 'old Staff',
      taskContext: 'old context',
      workerRunId: 'old-run',
      workerPid: 123,
      workerStartedAt: 1,
      workerHeartbeatAt: 1,
      workerRecoveryCount: 2,
      lastError: 'old error',
      completedIssues: [8],
      stagingGreen: true,
    },
  });
  h.setState({
    completedIssues: [8],
    stagingGreen: true,
    status: undefined,
    issue: undefined,
    pr: undefined,
    branch: undefined,
  });
  await dispatch(h.cfg, h.deps);
  assert.deepEqual(h.state(), {
    completedIssues: [8],
    stagingGreen: true,
    status: 'done',
    drainStatus: 'done',
    updatedAt: h.state().updatedAt,
  });
});

test('resetRunState clears stale run context and preserves completed issues', () => {
  const state = resetRunState(
    {
      issue: 21,
      pr: 20,
      branch: 'codex/issue-3',
      status: 'worker_recovery_pending',
      workerPid: -1,
      completedIssues: [1, 2, 3],
      stagingGreen: true,
      lastError: 'stale worker',
    },
    () => false,
  );
  assert.deepEqual(state.completedIssues, [1, 2, 3]);
  assert.equal(state.status, undefined);
  assert.equal(state.pr, undefined);
  assert.equal(state.branch, undefined);
  assert.equal(state.lastError, undefined);
  assert.equal(state.drainStatus, 'running');
});

test('resetRunState refuses a live Worker', () => {
  assert.throws(
    () => resetRunState({ status: 'worker_running', workerPid: 123 }, () => true),
    /cannot reset while Worker process 123 is still running/,
  );
});

test('recoverStaleLock removes only a lock owned by a dead process', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));
  assert.match(
    recoverStaleLock(root, () => false),
    /Recovered stale dispatcher lock/,
  );
  assert.equal(existsSync(lock), false);
  rmSync(root, { recursive: true, force: true });
});

test('recoverStaleLock refuses a live owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-lock-'));
  const lock = dispatcherLockPath(root);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 9999 }));
  assert.throws(() => recoverStaleLock(root, () => true), /owner PID 9999 is still running/);
  assert.equal(existsSync(lock), true);
  rmSync(root, { recursive: true, force: true });
});

test('dead reclaim marker recovers after its TTL', () => {
  const h = harness();
  const lock = dispatcherLockPath(h.root);
  const marker = join(lock, 'reclaiming');
  mkdirSync(marker, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), '{stale');
  writeFileSync(
    join(marker, 'owner.json'),
    JSON.stringify({ pid: 'dead', createdAt: Date.now() - 100 }),
  );
  utimesSync(marker, new Date(Date.now() - 100), new Date(Date.now() - 100));
  const token = acquire(h.deps, 1);
  assert.match(token, /^[0-9a-f-]+$/);
  assert.equal(existsSync(join(lock, 'reclaiming')), false);
  rmSync(lock, { recursive: true, force: true });
});

test('status hides verbose diagnostics unless explicitly requested', () => {
  const directory = mkdtempSync(join(tmpdir(), 'llmchat-status-'));
  const diagnostic = 'exit 2\nUnicode café\nTOKEN=hidden-value';
  try {
    mkdirSync(join(directory, '.llmchat'));
    writeFileSync(
      join(directory, '.llmchat', 'state.json'),
      JSON.stringify({ issue: 22, lastError: 'Worker failed.', lastErrorVerbose: diagnostic }),
    );
    const concise = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), '--status'],
      {
        cwd: directory,
        encoding: 'utf8',
      },
    );
    const verbose = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), '--status', '--verbose'],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(concise.status, 0, concise.stderr);
    assert.equal(verbose.status, 0, verbose.stderr);
    assert.equal(JSON.parse(concise.stdout).lastErrorVerbose, undefined);
    assert.equal(JSON.parse(verbose.stdout).lastErrorVerbose, diagnostic);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
