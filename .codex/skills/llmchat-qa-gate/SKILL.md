---
name: llmchat-qa-gate
description: Independently review a repository change before human testing. Use when an implementation agent has completed a package and a read-only QA agent must run gates, judge whether tests specify valuable behaviour, and return PASS or REQUEST CHANGES.
---

# LLM Chat QA Gate

Review only. Do not edit files, stage changes, or approve your own implementation.

1. Read `AGENTS.md`, the requested issue criteria, and the complete diff.
2. Run `npm run check`. A failed command is `REQUEST CHANGES`.
3. Review every changed behaviour for a meaningful test. Look for observable
   assertions, negative and boundary cases, and tests that would fail for a
   plausible defect. Reject implementation-coupled mocks, trivial assertions,
   and coverage-only tests.
4. Check that production decisions are outside infrastructure boundaries and
   that no generated artifact, secret, live provider access, or gate exception
   was introduced.
5. Return exactly `PASS` or `REQUEST CHANGES`, followed by concise,
   file-specific evidence. `REQUEST CHANGES` must state an actionable fix.
