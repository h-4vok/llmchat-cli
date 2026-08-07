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

The flow is deliberately sequential: `Automation Ready` label → visible claim → Worker → PR CI → QA/SDET → Staff/adversarial review → ready for human merge. QA runs before Staff, and every Worker revision repeats QA before Staff. `npm test`, build, and format are PR checks in GitHub Actions; the dispatcher only polls their status. There is no automatic merge to `main`, no worktrees, and no parallelism.

If the Worker process disappears, the dispatcher detects the stale lease, reconstructs context from local state and the existing PR, and starts a replacement Worker. To prepare a recovery test for an existing PR without changing its code, run `npm run sloop -- --prepare-recovery 1 --pr <number>` and then run `npm run sloop` normally.

For new work, the dispatcher fetches `origin/staging` and prepares the deterministic branch `codex/issue-<number>` from that exact remote SHA before starting the Worker. It persists the branch and `stagingBaseSha` in sloop state. Recovery reuses the persisted branch/PR and does not prepare a new branch. Worker PRs must target `staging`; another base is rejected. The dispatcher passes the claimed issue number as `LLMCHAT_ISSUE_NUMBER`; the Worker keeps exactly one `Closes #<number>` reference in each PR so a human merge into `staging` closes the related issue through GitHub's configured rules.

Roles and operating procedures: [`docs/sloop-engineering-v1.md`](docs/sloop-engineering-v1.md), [`docs/roles/`](docs/roles/).

## Reusable skills

Codex discovers the sloop skills in [`.codex/skills/`](.codex/skills/). Invoke them manually by name (`product-lead`, `dispatcher`, `worker`, `staff-reviewer`, `qa-sdet`, `triage-staging`), or let the dispatcher record the active skill at each transition. Each skill defines its entry conditions, outputs, state, and merge boundaries; the documents in `docs/roles/` retain only general operating context.
