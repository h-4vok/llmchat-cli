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

This repository contains the skeleton and the first end-to-end Gemini route. Open decisions are tracked as GitHub issues.

## Loop engineering v1

The canonical specification is [issue #13](https://github.com/h-4vok/llmchat-cli/issues/13). Run the manual dispatcher with `npm run loop -- --list`, `npm run loop -- --status`, or `npm run loop`. Copy `loop.config.json.example` to `loop.config.json` to configure worker/review/QA commands. Local state is stored in `.llmchat/state.json` and is never committed.

The flow is deliberately sequential: `Automation Ready` label → visible claim → worker → PR to `staging` → Staff/adversarial review → QA/SDET → smoke tests → ready for human merge. There is no automatic merge to `main`, no worktrees, and no parallelism. If staging is red, the dispatcher pauses; the Triage role must repair it and set `stagingGreen` in state before resuming.

Roles and operating procedures: [`docs/loop-engineering-v1.md`](docs/loop-engineering-v1.md), [`docs/roles/`](docs/roles/).

## Reusable skills

Codex discovers the loop skills in [`.codex/skills/`](.codex/skills/). Invoke them manually by name (`product-lead`, `dispatcher`, `worker`, `staff-reviewer`, `qa-sdet`, `triage-staging`), or let the dispatcher record the active skill at each transition. Each skill defines its entry conditions, outputs, state, and merge boundaries; the documents in `docs/roles/` retain only general operating context.
