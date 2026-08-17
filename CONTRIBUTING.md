# Contributing

Read `AGENTS.md` before changing code. Start from a clean checkout and install dependencies with:

```text
npm install
```

Before opening or updating a PR, run:

```text
npm install
npm run check
```

Use `npm run format` to apply Prettier. `npm run check` verifies formatting,
linting, tests, and 100% source coverage. `npm run mutation` remains an
optional diagnostic until its dedicated issue is resolved. Tests and CI must be
offline and deterministic: never use provider credentials, real browser
profiles, or live provider UI. PRs must keep the blocking checks green and must
not change functional scope without an associated issue.

Report bugs and propose changes through GitHub issues. Remove prompts,
responses, screenshots, profiles, logs, credentials, and other private provider
data before attaching diagnostics. Human provider checks are manual and outside
CI. Implementation changes require the independent QA gate described in
`AGENTS.md` before human testing.
