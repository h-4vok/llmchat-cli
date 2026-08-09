# llmchat-cli

CLI foundation for provider-backed chat. The MVP uses a deterministic simulation so it can be used and tested without network access; successful output goes to `stdout` and errors go to `stderr`.

## MVP

- Supported provider: `gemini`.
- The selected default is stored in the user-local configuration directory (`$XDG_CONFIG_HOME/llmchat/config.json`, or the platform equivalent).
- Real provider requests, authentication, streaming, and additional providers are planned for later phases.

## Usage

```text
llmchat config set-default-provider gemini
llmchat chat "Explain what an API is in one sentence"
llmchat chat "Explain what an API is" --provider gemini
llmchat config clear-default-provider
```

Use `llmchat --help` and `llmchat config --help` for command usage and supported values. A provider can be passed before or after the prompt; the canonical form is `llmchat chat "<prompt>" --provider <provider>`.

## Development

```text
npm install
npm run build
npm test
```

To install the current checkout as the global `llmchat` command while developing:

```text
npm run install:global
llmchat --help
llmchat chat --provider gemini "hello"
```

Remove the global development link with `npm run uninstall:global`.

This repository contains the skeleton and the first end-to-end Gemini route. Open decisions are tracked as GitHub issues.

## Sloop engineering v1

The canonical specification is [issue #13](https://github.com/h-4vok/llmchat-cli/issues/13). Run the manual dispatcher with `npm run sloop -- --list`, `npm run sloop -- --status`, or `npm run sloop`. Copy `sloop.config.json.example` to `sloop.config.json` to configure worker/review/QA commands. Local state is stored in `.llmchat/state.json` and is never committed.

When a loop stops, `lastError` is a concise human-readable summary and `lastErrorVerbose` retains the complete redacted diagnostic. `npm run sloop -- --status` returns only `issue`, `pr`, `status`, and `lastError`; use `npm run sloop -- --status --verbose` for the complete persisted state and diagnostic. Each role command must be an explicit `{ command, args, timeoutMs, retries }` object. For `codex exec`, include exactly one valid `--sandbox` in that role's `args`; the dispatcher does not inject arguments. `logRoleInvocation` defaults to `true` and can be set to `false` to suppress executable/argv logging. The legacy `codexSandbox` setting is rejected; migrate by adding each role's sandbox to its own args.

The flow is deliberately sequential: `Automation Ready` label → visible claim → Worker → PR CI → QA/SDET → Staff/adversarial review → ready for human merge. QA runs before Staff, and every Worker revision repeats QA before Staff. `npm test`, build, and format are PR checks in GitHub Actions; the dispatcher only polls their status. There is no automatic merge to `main`, no worktrees, and no parallelism.

If the Worker process disappears, the dispatcher detects the stale lease, reconstructs context from local state and the existing PR, and starts a replacement Worker. To prepare a recovery test for an existing PR without changing its code, run `npm run sloop -- --prepare-recovery 1 --pr <number>` and then run `npm run sloop` normally.

If a run reaches `maxReviewRounds`, it pauses in `review_cap_pending` before starting another Worker. A human resolves the one active run with `npm run sloop -- --resolve-review-cap --additional-rounds <N> --steer "..."`, repeatable `--waive Q<n>|S<n>`, or `--waive-all-outstanding`; this is a per-run budget and never edits `sloop.config.json`. A waive never edits the PR. With no extra rounds, every outstanding finding must be waived and CI/mergeability must remain green before the run becomes ready for human merge. `--resolve-review-cap --abandon --steer "..."` is terminal: it closes the PR and issue and applies `wontfix`, without merging. Decisions are recorded on both the issue and PR.

For new work, the dispatcher fetches `origin/staging` and prepares the deterministic branch `codex/issue-<number>` from that exact remote SHA before starting the Worker. It persists the branch and `stagingBaseSha` in sloop state. Recovery reuses the persisted branch/PR and does not prepare a new branch. Worker PRs must target `staging`; another base is rejected. The dispatcher passes the claimed issue number as `LLMCHAT_ISSUE_NUMBER`. `npm run sloop -- --link-issue <number>` links one additional issue to the active PR; the dispatcher keeps exactly one `Closes #<number>` reference for each state-authorized linked issue, so a human merge into `staging` closes all of them through GitHub's configured rules.

Roles and operating procedures: [`docs/sloop-engineering-v1.md`](docs/sloop-engineering-v1.md), [`docs/roles/`](docs/roles/).

## Reusable skills

Codex discovers the sloop skills in [`.codex/skills/`](.codex/skills/). Invoke them manually by name (`product-lead`, `dispatcher`, `worker`, `staff-reviewer`, `qa-sdet`, `triage-staging`), or let the dispatcher record the active skill at each transition. Each skill defines its entry conditions, outputs, state, and merge boundaries; the documents in `docs/roles/` retain only general operating context.
