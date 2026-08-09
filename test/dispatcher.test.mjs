import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  acquire,
  childProcessInvocation,
  command,
  dispatcherLockPath,
  dispatch,
  prepareWorkerBranch,
  prepareRecovery,
  recoverStaleLock,
  runSyncCommand,
  redactDiagnostic,
  workerBranchName,
  withIssueClosingReference,
  resetRunState,
  runCommand,
} from '../dist/dispatcher.js';

test('Windows batch commands use cmd.exe without Node shell mode', () => {
  assert.deepEqual(
    childProcessInvocation(
      'C:\\tools\\codex.cmd',
      ['exec', '--full-auto'],
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    ),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/v:off', '/c', '""C:\\tools\\codex.cmd" "exec" "--full-auto""'],
      windowsVerbatimArguments: true,
    },
  );
});

test('Windows batch commands execute from paths containing spaces', (t) => {
  if (process.platform !== 'win32') {
    t.skip('requires Windows cmd.exe');
    return;
  }

  const directory = mkdtempSync(join(tmpdir(), 'llmchat batch command-'));
  const executable = join(directory, 'echo argument.cmd');
  writeFileSync(executable, '@echo off\r\necho %~1\r\n');
  try {
    const launch = childProcessInvocation(executable, ['expected'], 'win32', process.env.ComSpec);
    const result = spawnSync(launch.command, launch.args, {
      encoding: 'utf8',
      shell: false,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'expected');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows batch commands reject cmd.exe syntax in argv before launch', () => {
  assert.throws(
    () =>
      childProcessInvocation(
        'C:\\tools\\codex.cmd',
        ['SAFE" & echo INJECTED & rem "'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    /unsafe cmd\.exe syntax/,
  );
});

test('synchronous Windows batch shims preserve verbatim cmd.exe command text', () => {
  let invocation;
  const output = runSyncCommand(
    'C:\\Program Files\\GitHub CLI\\gh.cmd',
    ['pr', 'view', '40'],
    (command, args, options) => {
      invocation = { command, args, options };
      return 'ok';
    },
    'win32',
    'C:\\Windows\\System32\\cmd.exe',
  );

  assert.equal(output, 'ok');
  assert.deepEqual(invocation, {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: [
      '/d',
      '/s',
      '/v:off',
      '/c',
      '""C:\\Program Files\\GitHub CLI\\gh.cmd" "pr" "view" "40""',
    ],
    options: {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
    },
  });
});

test('non-batch commands preserve their executable and arguments', () => {
  assert.deepEqual(childProcessInvocation('codex', ['exec'], 'win32'), {
    command: 'codex',
    args: ['exec'],
  });
});

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

function existingHumanReviewGuide(commit = 'abc1') {
  return `[Human Review Guide] round=1 commit=${commit}\n<!-- llmchat-dispatcher-human-review-guide -->\n\nSummary\nExercise the CLI change.\n\nSteps\n1. Run the focused command in a temporary directory.\n\nExpected results\n- The documented output appears.\n\nIsolation\nUse a temporary checkout and no credentials.\n\nLimitations / diagnostics\n- A failed command indicates the change is not ready.\n\nApproval checklist\n- [ ] Behavior matches the acceptance criteria.`;
}

function harness(
  issues = [{ number: 1, title: 'one', body: 'acceptance criteria' }],
  overrides = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-'));
  let state = overrides.initialState ?? {};
  const saves = [];
  const comments = [];
  const runs = [];
  const prBodyUpdates = [];
  const createdPrBodies = [];
  const reviews = [];
  const pr = {
    number: 14,
    state: 'OPEN',
    baseRefName: 'staging',
    headRefName: overrides.headRefName ?? 'codex/issue-1',
    headRefOid: 'abc0',
    body: overrides.prBody ?? 'Summary',
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
  const qaBodies = overrides.qaBodies;
  const staffBodies = overrides.staffBodies;
  const publishEvidence = {
    worker: true,
    qa: true,
    staff: true,
    ...(overrides.publishEvidence ?? {}),
  };
  const humanVerification = overrides.humanVerification ?? true;
  for (let guide = 0; guide < (overrides.existingHumanGuides ?? 0); guide += 1)
    pr.comments.push({ body: existingHumanReviewGuide() });
  if (overrides.malformedHumanGuide)
    pr.comments.push({ body: '[Human Review Guide] round=1 commit=abc1\n\nSummary\nInjected.' });
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
        if (overrides.workerCreatesPr) {
          // Model the Worker passing the dispatcher-owned payload directly to
          // `gh pr create --body-file`; this is the initial remote PR body.
          pr.body = spec.env.LLMCHAT_PR_BODY;
          createdPrBodies.push(pr.body);
        }
        spec.onStart?.(1000 + workerCount);
        spec.onHeartbeat?.();
        if (publishEvidence.worker) {
          const verification = humanVerification
            ? `\n\n[Human Verification]\n\`\`\`json\n${JSON.stringify({ summary: 'Exercise the CLI change.', steps: ['Run the focused command in a temporary directory.'], expected: ['The documented output appears.'], isolation: 'Use a temporary checkout and no credentials.', limitations: ['A failed command indicates the change is not ready.'], checklist: ['Behavior matches the acceptance criteria.'] })}\n\`\`\``
            : '';
          pr.comments.push({
            body: `[Worker] round=${round} status=ready_for_review pr=${pr.number} base=staging commit=${pr.headRefOid}${verification}`,
            createdAt: `${workerCount}`,
          });
        }
        return `WORKER_RESULT pr=${pr.number} base=staging`;
      }
      if (role === 'qa') {
        qaCount += 1;
        const verdict = qaVerdicts[qaCount - 1] ?? qaVerdicts.at(-1);
        if (publishEvidence.qa)
          reviews.push({
            body:
              qaBodies?.[qaCount - 1] ??
              `[QA/SDET Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,
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
            body:
              staffBodies?.[staffCount - 1] ??
              `[Staff Review] round=${round} verdict=${verdict} commit=${pr.headRefOid}`,
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
    updatePullRequestBody: async (number, body) => {
      assert.equal(number, pr.number);
      pr.body = body;
      prBodyUpdates.push({ number, body });
    },
    pullRequestBody: () => pr.body,
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
    prBodyUpdates,
    createdPrBodies,
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

test('failed commands preserve complete multiline stdout and stderr diagnostics', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',
            args: [
              '-e',
              "process.stdout.write('worker stdout one\\nworker stdout two\\n'); process.stderr.write('worker stderr one\\nworker stderr two\\n'); process.exit(17)",
            ],
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /exit 17/);
      assert.match(error.message, /stdout:\nworker stdout one\nworker stdout two\n/);
      assert.match(error.message, /stderr:\nworker stderr one\nworker stderr two\n/);
      return true;
    },
  );
});

test('failed retries retain diagnostics from every unsuccessful attempt', async () => {
  await assert.rejects(
    () =>
      runCommand(
        command(
          {
            command: 'node',
            args: [
              '-e',
              "process.stdout.write('retry stdout\\n'); process.stderr.write('retry stderr\\n'); process.exit(17)",
            ],
            retries: 1,
          },
          0,
        ),
      ),
    (error) => {
      assert.match(error.message, /failed after 2 attempt\(s\)/);
      assert.match(error.message, /attempt 1: exit 17/);
      assert.match(error.message, /attempt 2: exit 17/);
      assert.equal((error.message.match(/retry stdout/g) ?? []).length, 2);
      assert.equal((error.message.match(/retry stderr/g) ?? []).length, 2);
      return true;
    },
  );
});

test('PR closing reference uses the claimed issue exactly once for creation and recovery', () => {
  assert.equal(withIssueClosingReference('Summary', 17), 'Summary\n\nCloses #17');
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nclosed #99', 17),
    'Summary\n\nCloses #17',
  );
  assert.throws(() => withIssueClosingReference('', 0), /issue number must be positive/);
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
  assert.equal(h.runs[0].env.LLMCHAT_ISSUE_NUMBER, '1');
  assert.equal(h.reviews[0].body.startsWith('[QA/SDET Review]'), true);
  assert.equal(h.reviews[1].body.startsWith('[Staff Review]'), true);
  const guide = h.comments.find(([, body]) => body.startsWith('[Human Review Guide]'))?.[1] ?? '';
  assert.match(guide, /commit=abc1/);
  assert.match(guide, /Isolation/);
  assert.match(guide, /Approval checklist/);
  assert.equal(h.state().branch, 'codex/issue-1');
  assert.equal(h.state().stagingBaseSha, 'staging-sha-1');
});

test('existing human guide for the current commit is not published twice', async () => {
  const h = harness(undefined, { existingHumanGuides: 1 });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length, 0);
});

test('duplicate human guides for the current commit block ready_for_human_merge', async () => {
  const h = harness(undefined, { existingHumanGuides: 2 });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'worker_recovery_pending');
  assert.match(h.state().lastError, /Expected exactly one \[Human Review Guide\].*duplicates/);
  assert.equal(h.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length, 0);
});

test('malformed current human guide blocks ready_for_human_merge', async () => {
  const h = harness(undefined, { malformedHumanGuide: true });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'worker_recovery_pending');
  assert.match(h.state().lastError, /not dispatcher-rendered/);
  assert.equal(h.comments.filter(([, body]) => body.startsWith('[Human Review Guide]')).length, 0);
});

test('incomplete Worker human-verification evidence blocks before ready_for_human_merge', async () => {
  const h = harness(undefined, { humanVerification: false });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'worker_recovery_pending');
  assert.match(h.state().lastError, /complete \[Human Verification\] guide/);
});

test('create and recovery smoke paths capture the persisted claimed-issue PR body', async () => {
  const h = harness([{ number: 17, title: 'seventeen', body: 'criteria' }], {
    prBody: 'Summary\n\nCloses #1\nClose #99',
  });
  await dispatch(h.cfg, h.deps);
  // This is the create-path handoff: the Worker receives the exact body contract
  // that it must pass to `gh pr create`.
  const workerInput =
    h.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';
  assert.match(workerInput, /gh pr create\/edit \(or equivalent\) to persist that body/);
  assert.match(workerInput, /state-authorized closing reference/);

  // This is the recovery/update path: the captured `gh pr edit --body-file`
  // equivalent receives one normalized reference and no stale references.
  assert.deepEqual(h.prBodyUpdates, [{ number: 14, body: 'Summary\n\nCloses #17' }]);
  assert.equal((h.prBodyUpdates[0].body.match(/^Closes #17$/gm) ?? []).length, 1);
});

test('dispatcher-generated body is used by the initial PR creation path', async () => {
  const h = harness([{ number: 17, title: 'seventeen', body: 'criteria' }], {
    workerCreatesPr: true,
  });
  await dispatch(h.cfg, h.deps);
  const workerInput =
    h.runs.find((run) => run.input?.includes('Use the worker skill'))?.input ?? '';
  assert.equal(h.runs[0].env.LLMCHAT_PR_BODY, 'Closes #17');
  assert.deepEqual(h.createdPrBodies, ['Closes #17']);
  assert.equal((h.createdPrBodies[0].match(/^Closes #17$/gm) ?? []).length, 1);
  assert.match(workerInput, /dispatcher has generated the initial PR body in LLMCHAT_PR_BODY/);
  assert.match(workerInput, /gh pr create using --body-file/);
});

test('worker branch convention is deterministic and rejects invalid issue numbers', () => {
  assert.equal(workerBranchName(16), 'codex/issue-16');
  assert.throws(() => workerBranchName(0), /issue number must be positive/);
});

test('PR closing references preserve authorized linked issues and remove stale ones', () => {
  assert.equal(
    withIssueClosingReference('Summary\n\nCloses #1\nClose #17\nClosed #99', 17, [39]),
    'Summary\n\nCloses #17\nCloses #39',
  );
});

test('review cap pauses before a replacement Worker is launched', async () => {
  const h = harness([{ number: 1, title: 'one' }], {
    qaVerdicts: ['changes_requested'],
    config: { maxReviewRounds: 1 },
  });
  await dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'review_cap_pending');
  assert.equal(h.state().reviewRound, 2);
  assert.equal(h.counts().workerCount, 1);
  assert.deepEqual(h.state().reviewCap.outstandingFindingIds, []);
});

test('a local HITL budget and steer are included in the resumed Worker context', async () => {
  const h = harness([{ number: 1, title: 'one' }], {
    initialState: {
      issue: 1,
      pr: 14,
      branch: 'codex/issue-1',
      status: 'worker_recovery_pending',
      reviewRound: 2,
      reviewCap: {
        capRound: 1,
        additionalRounds: 1,
        waivedFindingIds: ['Q4'],
        outstandingFindingIds: ['Q4'],
        decisionSha: 'abc0',
        steer: 'Do not change GitHub configuration.',
      },
    },
    config: { maxReviewRounds: 1 },
  });
  h.deps.checkoutWorkerBranch = () => {};
  await dispatch(h.cfg, h.deps);
  assert.match(h.runs[0].input, /HITL steer \(binding\): Do not change GitHub configuration/);
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

function assertPersistedDiagnostic(state, phase, diagnostic, context) {
  assert.ok((state.lastError.match(/[.!?]+/g) ?? []).length <= 4, state.lastError);
  assert.match(state.lastError, new RegExp(`during ${phase}`));
  for (const value of context) assert.match(state.lastError, value);
  assert.equal(state.lastErrorVerbose, diagnostic);
}

test('empty diagnostic fallback persists concise blocked context separately from verbose output', async () => {
  const h = harness([{ number: 1, title: 'a' }]);
  h.deps.prepareWorkerBranch = () => {
    throw new Error('');
  };
  await dispatch(h.cfg, h.deps);
  assertPersistedDiagnostic(
    h.state(),
    'blocked',
    'No diagnostic output was captured during blocked.',
    [/issue #1/],
  );
  assert.match(h.state().lastError, /No diagnostic output was available/);
});

test('QA feedback persists concise context and the complete diagnostic', async () => {
  const diagnostic =
    '[QA/SDET Review] round=1 verdict=changes_requested commit=abc1\n[Q1] fail - café output';
  const h = harness([{ number: 1, title: 'a' }], {
    qaVerdicts: ['changes_requested', 'passed'],
    qaBodies: [diagnostic],
  });
  await dispatch(h.cfg, h.deps);
  const persisted = h.saves.find((state) => state.status === 'qa_changes_requested');
  assertPersistedDiagnostic(persisted, 'qa changes requested', diagnostic, [/issue #1/, /PR #14/]);
});

test('Staff feedback persists concise context and the complete diagnostic', async () => {
  const diagnostic =
    '[Staff Review] round=1 verdict=changes_requested commit=abc1\n[S1] high - reproducible output';
  const h = harness([{ number: 1, title: 'a' }], {
    staffVerdicts: ['changes_requested', 'approved'],
    staffBodies: [diagnostic],
  });
  await dispatch(h.cfg, h.deps);
  const persisted = h.saves.find((state) => state.status === 'staff_changes_requested');
  assertPersistedDiagnostic(persisted, 'staff changes requested', diagnostic, [
    /issue #1/,
    /PR #14/,
  ]);
});

test('recovery failure persists concise issue and PR context with complete diagnostics', async () => {
  const h = harness([{ number: 1, title: 'a' }], {
    initialState: prepareRecovery(
      { completedIssues: [1], branch: 'codex/issue-1' },
      1,
      14,
      Date.now(),
      100,
    ),
  });
  h.deps.checkoutWorkerBranch = () => {
    throw new Error('recovery checkout failed\nexit 2');
  };
  await dispatch(h.cfg, h.deps);
  assertPersistedDiagnostic(
    h.state(),
    'worker recovery pending',
    'recovery checkout failed\nexit 2',
    [/issue #1/, /PR #14/],
  );
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
  const ciFailure = h.saves.find((state) => state.status === 'ci_failed');
  assertPersistedDiagnostic(ciFailure, 'ci failed', '[CI] pr-checks: FAILURE', [
    /issue #1/,
    /PR #14/,
  ]);
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

test('status remains concise by default and returns exact verbose diagnostics only on request', () => {
  const h = harness();
  mkdirSync(join(h.root, '.llmchat'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'state.json'),
    JSON.stringify({
      issue: 9,
      pr: 42,
      status: 'worker_running',
      lastError: 'short summary',
      lastErrorVerbose: 'line one\nUnicode: café\nline three',
      branch: 'codex/issue-9',
      workerRecoveryCount: 3,
    }),
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
  assert.deepEqual(JSON.parse(status.stdout), {
    issue: 9,
    pr: 42,
    status: 'worker_running',
    lastError: 'short summary',
  });
  const verbose = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'dispatcher.js'), '--status', '--verbose'],
    { cwd: h.root, encoding: 'utf8' },
  );
  assert.equal(verbose.status, 0);
  assert.deepEqual(JSON.parse(verbose.stdout), {
    issue: 9,
    pr: 42,
    status: 'worker_running',
    lastError: 'short summary',
    lastErrorVerbose: 'line one\nUnicode: café\nline three',
    branch: 'codex/issue-9',
    workerRecoveryCount: 3,
  });
});

test('status rejects unsupported flag combinations', () => {
  const h = harness();
  for (const args of [
    ['--status', '--list'],
    ['--status', '--verbose', '--list'],
    ['--status', '--unknown'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), ...args],
      { cwd: h.root, encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--status accepts only the optional --verbose flag/);
    assert.equal(result.stdout, '');
  }
});

test('diagnostic redaction preserves safe multiline output and hides common credentials', () => {
  const output = redactDiagnostic(
    'exit 1\nGITHUB_TOKEN=secret-value\n{"password":"p@ss"}\nhttps://example.test/log',
  );
  assert.match(output, /exit 1/);
  assert.match(output, /https:\/\/example.test\/log/);
  assert.doesNotMatch(output, /secret-value|p@ss/);
  assert.match(output, /\[REDACTED\]/);
});

test('diagnostic redaction removes complete Authorization header values', () => {
  const output = redactDiagnostic(
    'Authorization: Basic dXNlcjpwYXNzd29yZA==\nProxy-Authorization: Bearer proxy-secret\nurl=https://example.test/log',
  );
  assert.match(output, /Authorization: \[REDACTED\]/);
  assert.match(output, /Proxy-Authorization: \[REDACTED\]/);
  assert.doesNotMatch(output, /dXNlcjpwYXNzd29yZA==|proxy-secret/);
  assert.match(output, /https:\/\/example\.test\/log/);
});

test('diagnostic redaction removes complete prefixed header values', () => {
  const output = redactDiagnostic(
    '> Authorization: Basic dXNlcjpwYXNzd29yZA==\ncurl: Proxy-Authorization: Basic cHJveHk6c2VjcmV0\nrequest headers: Cookie: session=one; csrf=two\ntrace: Set-Cookie: session=three; HttpOnly',
  );
  assert.match(output, /> Authorization: \[REDACTED\]/);
  assert.match(output, /curl: Proxy-Authorization: \[REDACTED\]/);
  assert.match(output, /request headers: Cookie: \[REDACTED\]/);
  assert.match(output, /trace: Set-Cookie: \[REDACTED\]/);
  assert.doesNotMatch(
    output,
    /dXNlcjpwYXNzd29yZA==|cHJveHk6c2VjcmV0|session=one|csrf=two|session=three/,
  );
});

test('diagnostic redaction removes short Bearer credentials', () => {
  const output = redactDiagnostic('Bearer abc\nBearer secret\nBearer a');
  assert.equal(output, 'Bearer [REDACTED]\nBearer [REDACTED]\nBearer [REDACTED]');
});

test('diagnostic redaction removes URL userinfo and complete cookie header values', () => {
  const output = redactDiagnostic(
    'https://alice:supersecret@example.test/log\nCookie: session=one; csrf=two\nSet-Cookie: session=three; HttpOnly\nhttps://example.test/safe',
  );
  assert.match(output, /https:\/\/\[REDACTED\]@example\.test\/log/);
  assert.match(output, /Cookie: \[REDACTED\]/);
  assert.match(output, /Set-Cookie: \[REDACTED\]/);
  assert.match(output, /https:\/\/example\.test\/safe/);
  assert.doesNotMatch(output, /alice|supersecret|session=one|csrf=two|session=three/);
});

test('legacy lastError-only state remains readable in both status modes', () => {
  const h = harness();
  mkdirSync(join(h.root, '.llmchat'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'state.json'),
    JSON.stringify({ issue: 9, status: 'blocked', lastError: 'legacy failure summary' }),
  );
  for (const args of [['--status'], ['--status', '--verbose']]) {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), ...args],
      {
        cwd: h.root,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      issue: 9,
      status: 'blocked',
      lastError: 'legacy failure summary',
    });
  }
});

test('successful state without errors remains unchanged in both status modes', () => {
  const h = harness();
  mkdirSync(join(h.root, '.llmchat'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'state.json'),
    JSON.stringify({ issue: 9, status: 'claimed' }),
  );
  for (const args of [['--status'], ['--status', '--verbose']]) {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'dispatcher.js'), ...args],
      {
        cwd: h.root,
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { issue: 9, status: 'claimed' });
  }
});

test('verbose status preserves quotes and shell-like diagnostic text exactly', () => {
  const h = harness();
  const diagnostic = 'stdout: "quoted"\nstderr: $(whoami) & echo %PATH%\nexit=17';
  mkdirSync(join(h.root, '.llmchat'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'state.json'),
    JSON.stringify({
      issue: 9,
      status: 'blocked',
      lastError: 'short summary',
      lastErrorVerbose: diagnostic,
    }),
  );
  const verbose = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'dispatcher.js'), '--status', '--verbose'],
    { cwd: h.root, encoding: 'utf8' },
  );
  assert.equal(verbose.status, 0, verbose.stderr);
  assert.equal(JSON.parse(verbose.stdout).lastErrorVerbose, diagnostic);
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
