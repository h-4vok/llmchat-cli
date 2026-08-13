# llmchat-cli

CLI for provider-backed chat through a dedicated persistent browser profile. Tests use deterministic injected boundaries and never access provider UI, credentials, or normal browser profiles. All visual output uses one `stdout` flow; success exits with `0` and every failure exits with `1`.

## MVP

- Supported provider: `gemini`.
- The selected default is stored in the user-local configuration directory (`$XDG_CONFIG_HOME/llmchat/config.json`, or the platform equivalent).
- Gemini authentication is completed manually in a dedicated Brave or Chromium/Chrome profile; CAPTCHA and anti-bot checks are never automated.
- If the initial Gemini probe is indeterminate, `auth gemini` opens the dedicated visible window, reports that login is needed, and sends one native notification. Complete login there; the browser remains open with redacted diagnostics and a provider-viewport capture if Gemini's UI cannot be identified. A `chat` request in this state is never submitted and exits `1`; close the retained browser yourself after manual resolution.
- Colors are always active in the MVP. Every visual line has an aligned speaker label, `##`, a local `[HH:MM]` timestamp, and plain text.

## Usage

```text
llmchat config set-default-provider gemini
llmchat auth gemini
llmchat chat "Explain what an API is in one sentence"
llmchat chat "Explain what an API is" --provider gemini --model "Gemini 2.5 Pro"
llmchat health gemini
llmchat config clear-default-provider
```

Use `llmchat --help` and `llmchat config --help` for command usage and supported values. A provider can be passed before or after the prompt; the canonical form is `llmchat chat "<prompt>" --provider <provider>`.

Gemini reasoning values are `"Standard"` and `"Extended thinking"`; the default is `"Standard"`. Values are resolved per Gemini model; unknown provider-specific values produce a warning and do not stop the chat.

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

## Manual Gemini health and human test

The Playwright health check is deliberately manual and outside CI. It reuses the dedicated Gemini profile, validates the empty composer, and does not send a prompt. Gemini may hide the send control until text is entered; in that state health reports a deferred capability and does not claim that send was validated:

```text
npm run install:global
llmchat auth gemini
llmchat health gemini
llmchat chat "Reply with exactly: human-test-ok" --provider gemini --model "<exact visible model name>"
```

Use `npm run install:global` before manual CLI testing so the global `llmchat`
command points to the current checkout. `npm run build` only compiles `dist/`
and does not update the globally linked command.

Run the final `chat` command only when intentionally performing the human test. That smoke chat validates text entry, send, and response extraction. The adapter attempts to select the exact visible model text; if that text is unavailable or selection fails, it continues with Gemini's active model as required by #8. Confirm the visible model outcome during the human smoke—the automated test does not guarantee exact selection. Gemini's web UI is volatile, so selector compatibility must also be confirmed manually after UI changes. A failed UI check keeps the provider browser available and writes redacted local diagnostics plus a provider-viewport screenshot.

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

Sequential commands lease and reuse the stable provider profile. If commands overlap, exclusive filesystem leases assign each additional interactive browser a persistent sibling profile named `.concurrent-N`; Chromium therefore never receives the same `userDataDir` concurrently. A secondary slot may require manual sign-in on first use, then keeps its own browser-managed session for later overlapping runs. LLM Chat creates and selects these directories but never reads, copies, or merges browser credentials. Successful commands release only the small lease directory, not profile data; a preserved failure keeps its lease while the process and browser remain available for inspection.

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
