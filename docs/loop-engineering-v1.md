# Loop engineering v1 operation

## Execution

1. Product Lead completes the requirements, criteria, risks, and out-of-scope items; only then applies `Automation Ready`.
2. Dispatcher runs `npm run loop` manually, selects the lowest-numbered open issue, and writes local state. It never starts another active task.
3. Worker creates a branch from `staging`, implements the issue in the local checkout, and opens a PR whose base is `staging`.
4. Staff Reviewer posts a separate adversarial comment. QA/SDET posts another comment with tests and smoke-test results. Feedback returns to the Worker and increments `reviewRound`.
5. Only when both reviews are clear and smoke tests pass is `ready_for_human_merge` set. A person decides whether to merge; `main` remains protected from the loop.

## Recovery

A staging failure sets `stagingGreen: false`, sets the state to `blocked`, and pauses the dispatcher. Triage creates or prioritizes a repair, publishes a diagnosis, and runs `stagingHealthCommand`. Only after it succeeds does Triage mark staging green and resume the loop.

## Multi-issue batches

For a batch, create `integration/<identifier>` from `staging`, associate each issue in comments, and open one PR to `staging`. The sequence and single-active-task rule remain in force; branches are not mixed and merges are never automatic.

## Configuration and extensions

`loop.config.json` can replace the Codex worker, Staff review, QA, smoke, and staging-health commands. State may be migrated to a remote store and commands may use API adapters in the future without changing the gating policy.
