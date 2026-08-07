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
  prepareRecovery,
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

function harness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-'));
  let state = overrides.initialState ?? {};
  const comments = [];
  const runs = [];
  const reviews = [];
  const pr = {
    number: 14,
    state: 'OPEN',
    baseRefName: 'staging',
    headRefName: 'codex/test',
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
        pr.comments.at(-1).body +=
          `\n\n[Human Verification]\n\`\`\`json\n${JSON.stringify({ summary: 'Exercise the CLI change.', steps: ['Run the focused command.'], expected: ['The documented output appears.'], isolation: 'Use a temporary checkout and no credentials.', limitations: ['A failed command indicates the change is not ready.'], checklist: ['Behavior matches the acceptance criteria.'] })}\n\`\`\``;
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
  assert.equal(
    h.comments.some(([, body]) => body.startsWith('[Human Review Guide]')),
    true,
  );
  assert.equal(h.state().branch, 'codex/issue-1');
  assert.equal(h.state().stagingBaseSha, 'staging-sha-1');
});

test('worker branch convention is deterministic and rejects invalid issue numbers', () => {
  assert.equal(workerBranchName(16), 'codex/issue-16');
  assert.throws(() => workerBranchName(0), /issue number must be positive/);
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
    initialState: prepareRecovery({ completedIssues: [1] }, 1, 14, now, 100),
  });
  h.deps.prepareWorkerBranch = () => {
    throw new Error('recovery must reuse the existing branch');
  };
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'ready_for_human_merge');
  assert.equal(h.state().pr, 14);
  assert.equal(h.counts().workerCount, 1);
  assert.equal(
    h.comments.some(([, body]) => body.includes('Worker perdido')),
    true,
  );
});

test('conflicting Worker PR is rejected before reviews', async () => {
  const h = harness([{ number: 1, title: 'a' }]);
  h.deps.pullRequest = () => ({
    number: 14,
    state: 'OPEN',
    baseRefName: 'staging',
    headRefName: 'codex/test',
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
  assert.equal(h.state().status, 'blocked');
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
    { pr: 15, completedIssues: [1, 2], status: 'done' },
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
