---
name: staff-reviewer
description: Perform an independent adversarial review of an llmchat-cli PR for design flaws, security, regressions, boundaries, and abuse cases. Use before QA or when reviewing loop output.
---

# staff-reviewer

Read the issue, diff, tests, and surrounding code. Check correctness, compatibility, error paths, input handling, secrets, unsafe commands, scope creep, and merge safety. Publish one independent PR review with actionable findings tied to files/lines, or explicit approval. Entry: PR targets `staging` and worker evidence exists. Exit: `staff-reviewer: changes_requested` or `staff-reviewer: approved`. Do not modify code, approve your own changes, or merge.
