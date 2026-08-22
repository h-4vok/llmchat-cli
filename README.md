# llmchat-cli

> **Experimental personal alpha.** `llmchat-cli` is an unofficial personal project and is not affiliated with, sponsored by, or endorsed by Google or Gemini. It automates a dedicated browser profile against a changing web UI. It may stop working, be blocked, or trigger provider verification without notice.

This repository is source-only. There is no official `llmchat-cli` package published on npm, and commands below must be run from a local checkout. Do not assume that a similarly named npm package is published by this project.

The project is provided under the MIT License, including its `AS IS` warranty disclaimer and limitation of liability. It offers no availability, compatibility, stability, or support guarantee. Use it at your own risk and follow the provider's terms. CAPTCHA, login, and account verification always require human intervention; this project is not presented as indetectable and does not attempt to bypass provider controls.

## Requirements

- Node.js 22 or newer.
- npm.
- Brave, Chromium, or compatible Chrome.
- A Gemini account whose authentication is completed manually.

## Install from source

```text
git clone https://github.com/h-4vok/llmchat-cli.git
cd llmchat-cli
npm install
npm run install:global
llmchat --help
```

The package remains private to prevent accidental npm publication. Do not use `npm install --global llmchat-cli`; this repository does not publish a registry package. Remove the local global link with:

```text
npm run uninstall:global
```

## Usage

```text
llmchat config set-default-provider gemini
llmchat auth gemini
llmchat chat "hola que tal" --provider demo
llmchat chat "Explain what an API is in one sentence"
llmchat chat "Explain what an API is" --provider gemini --model "Gemini 2.5 Pro"
llmchat chat "Explain what an API is" --output json
llmchat health gemini
llmchat config clear-default-provider
```

`chat` defaults to the existing human-readable `text` output. Use `--output json`,
`--output jsonl`, or `--output yaml` for a versioned (`schemaVersion: 1`)
structured contract. JSON and YAML emit one terminal document. JSONL emits
ordered activity records followed by exactly one terminal result record. A
structured failure uses the provider-neutral `CHAT_FAILED` code and exits
non-zero.

Gemini remains the factory default. `demo` is a deterministic local provider
for integrations, examples, and manual smoke tests: it never opens a browser,
uses credentials, creates a provider session, or makes a network request. It
answers `Demo response: <prompt>` and can be selected explicitly or configured
as the default with `llmchat config set-default-provider demo`. It accepts the
shared chat options without interpreting them; `--keep-browser-open` is rejected
because no browser exists.

Start the local MCP server over stdio with:

```text
llmchat mcp
```

The MCP surface has one tool: `ask_llm`. It is described so clients can discover
it for requests such as “use LLMChat”, “ask Gemini”, “delegate to Gemini”, or
“get a second opinion”. `prompt` is required; `provider`, `model`, and `reasoning`
are optional. The conversation is disposable by default and can be retained by
sending `disposableConversation: false`. Results include both compatible text
content and a versioned structured transcript.

Authentication, health, and configuration remain CLI responsibilities. If an
MCP request needs authentication, its error tells the caller which `llmchat auth`
command to run locally; the MCP never opens a login browser. The MCP does not
expose output formatting, browser lifetime, or system-instruction options.

Use `llmchat --help` and `llmchat config --help` for command usage. Gemini reasoning values are `Standard` and `Extended thinking`; unknown provider-specific values produce a warning and do not stop the chat.

## Alpha limitations and manual checks

The browser-backed provider is currently Gemini. Its selectors, model controls, login state, and response behaviour depend on a volatile web UI. Compatibility can change without a code release. Real Gemini checks are manual, non-deterministic, and outside CI:

```text
npm run install:global
llmchat auth gemini
llmchat health gemini
llmchat chat "Reply with exactly: human-test-ok" --provider gemini --model "<exact visible model name>"
```

`health` validates the empty composer without sending a prompt. Run the final `chat` command only when intentionally testing text entry, sending, and response extraction. If login, CAPTCHA, or another verification is required, resolve it visibly and manually. A failed check may keep the provider browser open and save local redacted diagnostics and a provider-viewport screenshot.

The browser automation currently uses Playwright, a dedicated persistent profile, and passes `--disable-blink-features=AutomationControlled` to the browser for compatibility with the existing alpha flow. That flag is not a stealth guarantee: the project does not promise indetectability or evasion of provider controls, and provider behaviour remains outside its control.

## Local profiles, diagnostics, and privacy

LLM Chat data is separate from normal browser profiles:

- Windows: `%LOCALAPPDATA%/llmchat`
- macOS: `~/Library/Application Support/llmchat`
- Linux: `$XDG_DATA_HOME/llmchat`, falling back to `~/.local/share/llmchat`

Each provider has isolated `profiles`, `logs`, `diagnostics`, and `screenshots` directories. They persist until manually deleted; there is no automatic retention or deletion. Every chat invocation appends a local diagnostic record containing its prompt and, when available, its response. These files may therefore contain sensitive prompts and provider responses. Screenshots can also contain visible provider content and are limited to the provider page viewport; they must not contain DevTools, browser internals, storage state, or authentication dialogs.

To remove local data, stop any `llmchat` process and delete the `llmchat` directory under the platform path above. The application does not provide automatic cleanup. Local overrides under `.llmchat-data/`, profiles, logs, diagnostics, screenshots, build output, coverage, and reports are ignored by Git.

Textual diagnostics use redaction for common cookies, credentials, tokens, API keys, authorization values, and passwords, but redaction is defense in depth and not an authorization boundary. Do not put secrets in prompts or bug reports.

## Development

```text
npm install
npm run check
npm run test:mcp
```

`npm run test:mcp` runs the reusable MCP suite. It is offline, deterministic,
and remains part of the normal unit tests, coverage, `npm run check`, and CI.

Run `npm run test:mcp:codex` for the opt-in live integration. It requires an
installed, authenticated Codex CLI plus network access and quota. The harness
starts the current local build as an isolated required MCP server, invokes only
the offline `demo` provider, and verifies Codex's JSONL `mcp_tool_call` events.
It does not use the globally installed `llmchat` or the user's LLMChat data.
Because it consumes a live Codex service, it is intentionally outside
`npm run check` and CI and fails with diagnostics instead of silently skipping.
On Windows the harness resolves the npm `codex.cmd` shim to its JavaScript
entrypoint and launches it without a shell. Set `CODEX_BIN` to an explicit
Codex `.exe`, `.js`, or npm `.cmd` path when automatic resolution is unsuitable.

Tests and CI never use provider credentials, real browser profiles, or live
provider UI. `npm run mutation` is an optional non-blocking diagnostic. See
`AGENTS.md` for the engineering rules and `CONTRIBUTING.md` for the contribution
workflow.

The canonical code-quality and review criteria are in [`docs/code-quality.md`](docs/code-quality.md).

## Adapter contract

`ProviderAdapter` exposes one high-level `executeChat` operation. Its request carries the model, prompt, and optional system-instructions name, and its response carries provider text. The adapter owns model selection, prompt entry, submission, response extraction, session detection, and UI sequencing. No selector, cookie, token, or browser-UI primitive appears in the shared contract.

The neutral `AdapterContext` contains dedicated local paths, non-session configuration, and a notifier. Secure storage is provisioned and verified before the CLI obtains the adapter or exposes those paths. Timeout and normalized diagnostic behaviour are owned by the CLI boundary; provider adapters also supply a manual health check.

This repository contains an experimental Gemini route. Future compatibility or distribution decisions require a new explicit issue.

## Security risks and mitigations

| Risk                                                | Mitigation                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Accidental use of a personal browser session        | Dedicated persistent profile per provider.                              |
| Local disclosure of sessions, prompts, or responses | Per-user data roots, restricted permissions, and Git ignore rules.      |
| Secrets in textual diagnostics                      | Narrow diagnostic schema and conservative redaction.                    |
| Secrets in screenshots                              | Provider viewport only; no browser internals or authentication dialogs. |
| Provider UI changes or intervention                 | Manual health checks and normalized diagnostics.                        |

Report bugs and propose changes through [GitHub issues](https://github.com/h-4vok/llmchat-cli/issues). Do not include credentials, profiles, screenshots, or private provider content in reports.
