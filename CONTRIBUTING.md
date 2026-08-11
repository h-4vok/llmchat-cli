# Contributing

Read `AGENTS.md` before changing code. Before opening or updating a PR, run:

```text
npm install
npm run check
```

Use `npm run format` to apply Prettier. `npm run check` verifies formatting,
linting, tests, and 100% source coverage. `npm run mutation` remains an
optional diagnostic until its dedicated issue is resolved. PRs must keep the
blocking checks green and must not change functional scope without an associated
issue.
