---
name: qa-sdet
description: Validate llmchat-cli PR acceptance criteria, regression coverage, smoke behavior, and reproducible test evidence. Use after staff review or for independent QA of loop changes.
---

# qa-sdet

Map every acceptance criterion to a check. Run focused tests, regression tests, build, and configured smoke/health commands. Record exact commands and outcomes in a separate PR comment. Entry: staff review approved or findings resolved. Exit: `qa-sdet: passed` or `qa-sdet: failed` with reproduction and `changes_requested`/`blocked`. Do not waive failures, alter tests to hide defects, or merge.
