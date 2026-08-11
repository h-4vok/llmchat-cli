# llmchat-cli

CLI foundation for provider-backed chat. The MVP uses a deterministic simulation so it can be used and tested without network access. All visual output uses one `stdout` flow; success exits with `0` and every failure exits with `1`.

## MVP

- Supported provider: `gemini`.
- The selected default is stored in the user-local configuration directory (`$XDG_CONFIG_HOME/llmchat/config.json`, or the platform equivalent).
- Real provider requests, authentication, streaming, and additional providers are planned for later phases.
- Colors are always active in the MVP. Every visual line has an aligned speaker label, `##`, a local `[HH:MM]` timestamp, and plain text.

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

## Adapter contract

`ProviderAdapter` exposes one high-level `executeChat` operation. Its request carries the model, prompt, and optional system-instructions name, and its response carries provider text. The adapter—not the CLI—owns model selection, prompt entry, submission, response extraction, session detection, and UI sequencing. No selector, cookie, token, or browser-UI primitive appears in the shared contract.

The neutral `AdapterContext` contains only dedicated local paths, non-session configuration, and a notifier. Secure storage is provisioned and verified before the CLI obtains the adapter or exposes those paths. Every CLI chat execution passes through the CLI-owned timeout boundary; after expiry it asks the adapter for one of the normalized states `progress`, `error`, `blocked`, or `session-required` and emits that state through the normal error flow. Adapter execution failures use the same flow without inventing a diagnostic. The timeout is cancelled after success, synchronous failure, asynchronous failure, or expiry. Every adapter also supplies a manual health check. Generic request/response parameters allow future provider capabilities to extend the contract without replacing existing adapters.

## Local profiles and diagnostics

LLM Chat data is separate from normal browser profiles:

- Windows: `%LOCALAPPDATA%/llmchat`
- macOS: `~/Library/Application Support/llmchat`
- Linux: `$XDG_DATA_HOME/llmchat`, falling back to `~/.local/share/llmchat`

Each provider receives isolated `profiles`, `logs`, `diagnostics`, and `screenshots` directories. These directories persist until the user deletes them; the application has no automatic cleanup operation. POSIX directories are created and re-applied as `0700`, while every created or reopened file is re-applied as `0600`. Existing logs are protected before any new bytes are appended and verified again afterward; POSIX appends refuse symbolic links. On Windows, an isolated PowerShell script receives paths as process arguments, replaces inherited ACLs with one explicit Full Control rule for the current identity, and reads the ACL back before storage is accepted.

Environment overrides and fallback homes must resolve to non-empty absolute paths; storage fails closed for empty, whitespace-only, or relative roots. Local development overrides use `.llmchat-data/`, which is ignored by Git; normal data roots are outside the repository. LLMChat stores private local data but does not integrate with or control the user's backup tools.

Diagnostic logs may contain prompts and responses. Only their explicit fields are serialized. Text redaction recursively sanitizes sensitive JSON objects and covers key/value or query forms of cookies, Basic/Bearer credentials, tokens, API keys, client secrets, authorization values, and passwords while preserving unrelated query parameters. Complete Cookie and Set-Cookie header values are removed. Adapter errors and timeout diagnostics are sanitized before visual output. Browser profiles remain opaque session containers: application code must never read, log, or emit their cookies, tokens, or passwords.

### Security risks and mitigations

| Risk                                                  | Mitigation                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Accidental use of a personal browser session          | Dedicated persistent profile directory per provider; adapters receive only that path.                                                      |
| Local disclosure of sessions, prompts, or responses   | Absolute per-user data root, repaired `0700`/`0600` POSIX modes, verified current-user Windows ACL, and Git ignore.                        |
| Secrets copied into textual diagnostics               | Narrow diagnostic schema plus conservative redaction of JSON/key-value secrets and complete cookie headers.                                |
| Secrets visible inside screenshots                    | Adapters must capture only the provider page viewport, never browser internals, storage state, developer tools, or authentication dialogs. |
| Insufficient evidence after UI/authentication failure | Logs, sanitized diagnostics, and screenshots remain local with no automatic deletion.                                                      |
| Provider UI changes or intervention                   | Normalized diagnostics and manual health checks leave UI interpretation in provider code while preserving its profile.                     |

The redactor is defense in depth, not an authorization boundary. Adapter implementations must not pass session material to output or diagnostic APIs in the first place.
