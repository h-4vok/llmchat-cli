---
name: code-quality-loop
description: Turn iterative coding corrections into reusable quality rules, canonical documentation, safe lint automation, and bounded independent review. Use when a conversation is discovering design rules through implementation feedback and those rules should persist for future work.
---

# Code quality loop

Convert repeated feedback into durable project practice. Keep AI context small, rules explicit, automation evidence-based.

## Loop

1. Start from real code in the project repository. Inspect the relevant files and bring an existing fragment to the discussion; do not invent standalone example code when working on project quality.
2. Implement smallest requested behavior; preserve unrelated work.
3. Capture user corrections as candidate rules. Separate behavior requirements, design criteria, tooling rules, and one-off preferences.
4. Generalize only when evidence supports it. Prefer a review question over a rigid law. Record justified exceptions.
5. Classify each rule:
   - automate safely → lint/test/config;
   - semantic judgment → review guide;
   - universal worker context → short `AGENTS.md` block;
   - project detail → canonical `docs/code-quality.md` (or existing equivalent).
6. Update the canonical project guide. Avoid duplicate documents.
7. Put only high-value checks in `AGENTS.md`; link detail conditionally for design review/exceptions.
8. Run lint, focused tests, formatting/link checks. Interpret all output; never hide failures.
9. Review independently before human testing when the project has a QA gate. Reviewer is read-only and returns `PASS` or `REQUEST CHANGES`.

If no suitable real fragment exists, say so and ask whether a synthetic example is acceptable before creating one.

## Review boundary

Do not create open-ended worker/reviewer debate. Reviewer reports location, risk, evidence, fix. Worker gets 1–2 bounded correction cycles; relaunch a fresh reviewer. Escalate persistent disagreement to the user.

## Rule quality

Ask: Is rule observable? General enough? Testable? Cheap to apply? False-positive risk? What exception is valid? Avoid premature abstractions and rules copied from one function without broader evidence.

## Compact context pattern

`AGENTS.md` should contain checks, not essays:

```md
## Code checks

- One semantic responsibility per unit.
- Separate orchestration from elementary operations.
- Keep contracts coherent.
- Handle errors with enough context.
- Name by purpose, role, observable contract.
- Run and interpret `npm run lint`.

For rationale and exceptions, see `docs/code-quality.md`.
```

Adapt command and paths to the project. Do not assume `npm`, ESLint, or these filenames.

## Handoff

Report: rules added, automation added, docs/context paths, lint/test results, unresolved warnings, and reviewer status. Do not claim completion while a lint failure is unexplained.
