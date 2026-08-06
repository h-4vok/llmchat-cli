---
name: triage-staging
description: Triage a red staging environment for llmchat-cli, identify root cause, apply or coordinate the minimal safe repair, and gate loop resumption on health evidence.
---

# triage-staging

When staging is red, pause the dispatcher and set `stagingGreen: false`. Gather failing checks, recent changes, logs, and a minimal reproduction; distinguish environment failure from product regression. Run `stagingHealthCommand` plus relevant tests. Entry: blocked loop or failed health. Exit: documented root cause and evidence, then set `stagingGreen: true` only after health passes; otherwise remain `blocked`. Do not bypass the gate or claim green on partial signals.
