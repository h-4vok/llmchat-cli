# llmchat-cli

CLI for sending a prompt to an authenticated web chat through a persistent browser profile, retrieving one response, and writing it to `stdout`; progress and errors go to `stderr`.

## MVP

- Supported provider: Gemini, using Chromium/Playwright and the persistent profile `~/.llmchat-cli/profiles/gemini`.
- One prompt per invocation; guided login, CAPTCHA handling, retries, advanced configuration, and alternate formats are not supported yet.
- ChatGPT and Perplexity are planned for later phases.

## Usage

```text
llmchat --provider gemini "Explain what an API is in one sentence"
llmchat --provider gemini --login
```

Requires Node.js 20+ and Chromium installed for Playwright. Login is completed manually in the browser window, and the session is retained in the local profile.

## Development

```text
npm install
npm run build
npm test
```

This repository contains the skeleton and the first end-to-end Gemini route. Open decisions are tracked as GitHub issues.

## Loop engineering v1

The canonical specification is [issue #13](https://github.com/h-4vok/llmchat-cli/issues/13). Run the manual dispatcher with `npm run loop -- --list`, `npm run loop -- --status`, or `npm run loop`. Copy `loop.config.json.example` to `loop.config.json` to configure worker/review/QA commands. Local state is stored in `.llmchat/state.json` and is never committed.

The flow is deliberately sequential: `Automation Ready` label → visible claim → worker → PR to `staging` → Staff/adversarial review → QA/SDET → smoke tests → ready for human merge. There is no automatic merge to `main`, no worktrees, and no parallelism. If staging is red, the dispatcher pauses; the Triage role must repair it and set `stagingGreen` in state before resuming.

Roles and operating procedures: [`docs/loop-engineering-v1.md`](docs/loop-engineering-v1.md), [`docs/roles/`](docs/roles/).

## Reusable skills

Codex discovers the loop skills in [`.codex/skills/`](.codex/skills/). Invoke them manually by name (`product-lead`, `dispatcher`, `worker`, `staff-reviewer`, `qa-sdet`, `triage-staging`), or let the dispatcher record the active skill at each transition. Each skill defines its entry conditions, outputs, state, and merge boundaries; the documents in `docs/roles/` retain only general operating context.
