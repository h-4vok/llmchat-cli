# Loop engineering v1 operation

## Execution

1. Product Lead completes the requirements, criteria, risks, and out-of-scope items; only then applies `Automation Ready`.
2. Dispatcher runs `npm run loop` manually, selects the lowest-numbered open issue, and writes local state. It never starts another active task.
3. Worker creates or updates a PR whose base is `staging`; the Worker publishes `[Worker]` evidence in the PR.
4. GitHub Actions owns format, test, and build gates. The dispatcher polls the required PR checks and never executes `npm test` as a local gate.
5. QA/SDET posts a review first. Staff Reviewer posts an independent adversarial review only after QA passes. Feedback returns to a replacement or continuing Worker and increments `reviewRound`.
6. Only when CI is green and QA plus Staff are clear on the current head is `ready_for_human_merge` set. A person decides whether to merge; `main` remains protected from the loop.

## PR comment protocol

Every review round has one publication per role. Markers are mandatory and case-sensitive: `[Staff Review]`, `[QA/SDET Review]`, and `[Worker]`. Staff findings use `S1`, `S2`, etc.; QA checks/findings use `Q1`, `Q2`, etc. Review publications start with `round=<N> verdict=...` and include `commit=<head SHA>`. Worker replies preserve the ID and use `status=fixed|answered|not_fixed`. Include `file:line` for source/test references and exact commands/results in QA evidence. The dispatcher treats exit code 0 as process success, then verifies the corresponding GitHub publication; stdout or JSON alone is never review evidence.

## Recovery

A Worker run persists its `runId`, PID, lease, heartbeat, PR, branch, head SHA, phase, and review context. On startup, a missing process or expired lease transitions to `worker_recovery_pending`. The dispatcher reads the issue, existing PR, CI, comments, reviews, and saved context, then starts a new Worker against the same PR. It never deletes GitHub history or creates a second PR during recovery.

## Multi-issue batches

For a batch, create `integration/<identifier>` from `staging`, associate each issue in comments, and open one PR to `staging`. The sequence and single-active-task rule remain in force; branches are not mixed and merges are never automatic.

## Configuration and extensions

`loop.config.json` configures the Worker, Staff, and QA role commands, required PR check names, polling timeouts, Worker lease, and review-round limit. `npm test`, build, and format belong in `.github/workflows/pr-checks.yml`, not in this configuration. State may be migrated to a remote store and commands may use API adapters in the future without changing the gating policy.
