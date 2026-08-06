import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { acquire, command, dispatch, runCommand } from '../dist/dispatcher.js';

const cfg = {
  stagingRef: 'staging',
  stagingHealthCommand: ['node', '-e', 'console.log(\'{"passed":true}\')'],
  workerCommand: ['node', '-e', 'console.log(\'{"pr":14,"base":"staging"}\')'],
  staffReviewCommand: ['node', '-e', 'console.log(\'{"verdict":"approved"}\')'],
  qaCommand: ['node', '-e', 'console.log(\'{"verdict":"approved"}\')'],
  smokeCommand: ['node', '-e', 'console.log(\'{"passed":true}\')'],
};
function harness(issues = [{ number: 1, title: 'one' }], overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'llmchat-'));
  let state = {};
  const comments = [];
  let runs = [];
  return {
    root,
    comments,
    runs,
    deps: {
      root,
      load: () => state,
      save: (s) => {
        state = s;
      },
      eligible: () => issues,
      comment: (i, b) => comments.push([i, b]),
      run: (s) => {
        runs.push(s);
        return runCommand(s);
      },
      now: () => Date.now(),
      pid: () => process.pid,
    },
    state: () => state,
    cfg: { ...cfg, ...overrides },
  };
}

test('commands validate argv, retries, timeout and no shell', () => {
  assert.deepEqual(command(['node', '-e', 'process.exit(0)'], 42, true).args, [
    '-e',
    'process.exit(0)',
    '42',
  ]);
  assert.throws(() => command({ command: 'node; malicious' }, 1), /shell operators/);
  assert.throws(
    () => runCommand(command({ command: 'node', args: ['-e', 'process.exit(2)'], retries: 1 }, 0)),
    /failed after 2 attempt/,
  );
  assert.throws(
    () =>
      runCommand(
        command({ command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'], timeoutMs: 10 }, 0),
      ),
    /failed/,
  );
});
test('integration drains issues and gates in order', () => {
  const h = harness([
    { number: 1, title: 'a' },
    { number: 2, title: 'b' },
  ]);
  dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'done');
  assert.equal(h.runs.length, 9);
  assert.deepEqual(
    h.runs.slice(0, 5).map((x) => x.command),
    ['node', 'node', 'node', 'node', 'node'],
  );
});
test('changes_requested repeats worker/review then proceeds', () => {
  let n = 0;
  const h = harness([{ number: 1, title: 'a' }], {
    staffReviewCommand: [
      'node',
      '-e',
      'console.log(process.argv[1]===\'1\'?\'{"verdict":"changes_requested"}\':\'{"verdict":"approved"}\')',
      '1',
    ],
  });
  const old = h.deps.run;
  h.deps.run = (s) => {
    if (s.args.some((arg) => arg.includes('process.argv[1]'))) {
      n++;
      return n === 1 ? '{"verdict":"changes_requested"}' : '{"verdict":"approved"}';
    }
    return old(s);
  };
  dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'done');
  assert.equal(h.state().reviewRound, 2);
  assert.equal(h.runs.filter((run) => run.args.some((arg) => arg.includes('{"pr":14'))).length, 2);
});
test('staging red persists blocked and green rerun recovers', () => {
  const h = harness([{ number: 1, title: 'a' }], {
    stagingHealthCommand: ['node', '-e', 'process.exit(1)'],
  });
  dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'blocked');
  assert.equal(h.state().stagingGreen, false);
  h.cfg.stagingHealthCommand = cfg.stagingHealthCommand;
  h.cfg.stagingHealthCommand = ['node', '-e', 'console.log(\'{"passed":true}\')'];
  dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'done');
  assert.equal(h.state().stagingGreen, true);
  const runCount = h.runs.length;
  dispatch(h.cfg, h.deps);
  assert.equal(h.runs.length, runCount + 1); // health check only; completed issue remains terminal
});
test('bad PR base and failing gates block, and lock contention is exclusive', () => {
  const h = harness([{ number: 1, title: 'a' }], {
    workerCommand: ['node', '-e', 'console.log(\'{"pr":14,"base":"main"}\')'],
  });
  dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'blocked');
  assert.deepEqual(h.state().completedIssues ?? [], []);
  const h2 = harness();
  h2.deps.root = h.root;
  mkdirSync(join(h.root, '.llmchat', 'dispatcher.lock'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'dispatcher.lock', 'owner.json'),
    JSON.stringify({ pid: process.pid, createdAt: Date.now() - 9999999 }),
  );
  assert.throws(() => dispatch(cfg, h2.deps), /already running/);
});

test('active --status remains observable and stale locks recover safely', () => {
  const h = harness();
  mkdirSync(join(h.root, '.llmchat'), { recursive: true });
  writeFileSync(
    join(h.root, '.llmchat', 'state.json'),
    JSON.stringify({ issue: 9, status: 'in_progress' }),
  );
  const status = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'dispatcher.js'), '--status'],
    { cwd: h.root, encoding: 'utf8' },
  );
  assert.equal(status.status, 0);
  assert.match(status.stdout, /in_progress/);
  mkdirSync(join(h.root, '.llmchat', 'dispatcher.lock'), { recursive: true });
  writeFileSync(join(h.root, '.llmchat', 'dispatcher.lock', 'owner.json'), '{not-json');
  h.deps.load = () => ({});
  dispatch(h.cfg, h.deps);
  assert.equal(h.state().status, 'done');
});

test('two stale-lock reclaimers have one atomic winner', () => {
  const h = harness();
  mkdirSync(join(h.root, '.llmchat', 'dispatcher.lock'), { recursive: true });
  writeFileSync(join(h.root, '.llmchat', 'dispatcher.lock', 'owner.json'), '{stale');
  const first = acquire(h.deps, 1);
  assert.match(first, /^[0-9a-f-]+$/);
  assert.throws(() => acquire(h.deps, 1), /already running/);
  rmSync(join(h.root, '.llmchat', 'dispatcher.lock'), { recursive: true, force: true });
});
