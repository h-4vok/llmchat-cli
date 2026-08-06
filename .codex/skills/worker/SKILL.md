---
name: worker
description: Implement one claimed llmchat-cli issue in the local checkout, open or update a PR targeting staging, and leave reproducible test evidence without merging. Use for loop work execution or manual implementation.
---

# worker

Work only on the claimed issue in the current checkout. Inspect the issue and `staging`, make the smallest coherent change, run relevant checks, and report files, tests, and residual risk. Create or update a PR with base `staging`. Entry: claimed/in_progress issue and a suitable checkout. Exit: PR plus evidence, or documented blocker. Update `worker: in_progress`, `worker: ready_for_review`, or `worker: blocked`. Do not work in parallel, alter unrelated changes, merge, or target `main`.

Review routing: recognize only exact leading markers `[Staff Review]` and `[QA/SDET Review]` as review feedback. Worker status/evidence comments begin `[Worker]` and are never feedback. Reply in the same thread, preserving IDs (`S<n>`/`Q<n>`): `- [Worker] round=<N> ref=<S<n>|Q<n>> status=<fixed|answered|not_fixed> — <response> (file:<line> if applicable)`. State changed files/commit and verification when fixed. Resolve only fixed or answered findings; never resolve approvals or evidence. Finish with `[Worker] round=<N> status=<ready_for_review|blocked>` plus tests and residual risk. Ignore unmarked comments unless a human explicitly directs otherwise.
