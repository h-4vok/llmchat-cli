---
name: code-reviewer
description: Lint-first code review with compact semantic criteria, evidence, and justified exceptions. Use for code review, quality work, or design diagnosis.
---

# Code reviewer

Review code, not slogans. Preserve intent. Report concrete risk, location, impact, fix.

## Flow

1. Read repo rules, diff, scripts.
2. Find lint cmd; run it. Interpret every error/warn. Ignore none. If blocked, report exact blocker.
3. Run focused deterministic tests/checks.
4. Apply repo guide. For `C:\src\llmchat-cli`, canonical guide: `docs/code-quality.md`.
5. Accept deviations only with clear contract/boundary/perf/framework/compat/ops reason; record why.

## Questions

- One semantic purpose? SRP lens, not rigid law.
- Orchestration separate from elementary ops?
- Contract coherent: inputs/output/effects/failures aligned?
- Error handled where meaning is knowable? Exception justified?
- Name = purpose/role/observable contract, not mechanism?
- Tests specify observable behavior?

Do not extract/rename to satisfy slogans. Follow data flow and error context.

## Provider

`resolveProvider(p)` uses explicit/default, decides invalid-provider error. `isValidProvider(p)` answers validity only; no error policy, no throw. Adapt split to contract.

## Report

State lint/test pass, warnings, failures, unverifiable parts. Never mark review complete with unexplained lint failure.
