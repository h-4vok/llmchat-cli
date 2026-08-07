---
name: dispatcher
description: Run and recover the llmchat-cli sequential sloop, including eligibility, visible claiming, state transitions, staging gates, and handoff to reusable role skills.
---

# dispatcher

Run the npm sloop commands. Select the lowest-numbered open `Automation Ready` issue, preserve one active task, and record every phase and skill in the issue and `.llmchat/state.json`. Entry: no active run and staging is not red. Exit: hand off to worker, staff-reviewer, then qa-sdet, or pause for triage-staging. Never create a parallel orchestrator, worktree, or automatic merge.
