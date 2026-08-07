---
name: staff-reviewer
description: Perform an independent adversarial review of an llmchat-cli PR for design flaws, security, regressions, boundaries, and abuse cases. Use before QA or when reviewing loop output.
---

# staff-reviewer

GitHub review publishing: use `gh pr review <number> --body-file <file> --comment`, or `gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST` with JSON containing `body` and `event: COMMENT`. Do not invent flags; check `gh pr review --help` when uncertain.

Read the issue, diff, tests, and surrounding code. Check correctness, compatibility, error paths, input handling, secrets, unsafe commands, scope creep, and merge safety. Publish one independent PR review comment per round using `[Staff Review] round=<N> verdict=<changes_requested|approved>`. Findings use `- [S<n>] <severity> <file>:<line> — <problem>; <requested fix>`; questions use `question`; approval says `No actionable findings.` Preserve actionable detail and file/line references. Never use `[Worker]` or `[QA/SDET Review]`. Entry: PR targets `staging` and worker evidence exists. Exit: `staff-reviewer: changes_requested` or `staff-reviewer: approved`. Do not modify code, approve your own changes, or merge.
