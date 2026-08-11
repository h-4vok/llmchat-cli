# Engineering rules

Use TDD for every behaviour: write a small failing behaviour test, make it pass
with the smallest change, then refactor. Tests specify observable behaviour, not
private structure.

Use YAGNI.

Use SOLID principles for methods, files and classes.

Keep infrastructure humble. Move decisions out of filesystem, process, browser,
network, and UI boundaries into testable modules.

All authored code in `src/` and `test/` must have cyclomatic complexity at most
4 and at most 150 code lines. Do not add suppressions, ignores, or exceptions.

Run `npm run check` before handoff. Tests and CI must be offline and deterministic:
never use provider credentials, real browser profiles, or live UI checks.

`npm run mutation` is a non-blocking diagnostic until its dedicated issue is
resolved; it is not part of `npm run check` or CI.

Implementation agents must not approve their own work. Before human testing, the
orchestrator launches a fresh, read-only reviewer using `$llmchat-qa-gate`. A
`REQUEST CHANGES` blocks the package; only `PASS` permits human testing.
