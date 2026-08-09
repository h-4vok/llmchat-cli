---
name: qa-sdet
description: Validate llmchat-cli PR acceptance criteria, regression coverage, smoke behavior, and reproducible test evidence. Use after staff review or for independent QA of sloop changes.
---

# qa-sdet

GitHub review publishing: use `gh pr review <number> --body-file <file> --comment`, or `gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST` with JSON containing `body` and `event: COMMENT`. Do not invent flags; check `gh pr review --help` when uncertain.

Map every acceptance criterion to a check. Run focused tests, regression tests, build, and configured smoke/health commands. Publish one comment per round beginning `[QA/SDET Review] round=<N> verdict=<passed|changes_requested|blocked>`. List checks as `- [Q<n>] <pass|fail|blocked> - <criterion>; <command> - <result>`. For defects preserve `file:<line>` and reproduction/requested fix; questions use `question`. Never use `[Worker]` or `[Staff Review]`. Entry: staff review approved or findings resolved. Exit: `qa-sdet: passed` or `qa-sdet: failed` with reproduction and `changes_requested`/`blocked`. Do not waive failures, alter tests to hide defects, or merge.

## Staging merge workflow

When the PR targets `staging`, GitHub may not populate `closingIssuesReferences` for a `Closes #<n>` reference before the PR is merged because `staging` is not the repository default branch. Do not request code changes solely because that API field is empty. Verify instead that the PR body contains exactly one closing reference for the claimed issue, that the reference uses the correct issue number, and that no direct issue-close or automatic-merge behavior was introduced. Treat the eventual GitHub auto-close as a post-merge human verification step. If this is the only remaining concern, mark it as post-merge verification and allow `ready_for_human_merge`.

If the same finding is returned unchanged and no additional pre-merge action can satisfy it, do not create another equivalent failure: record it as a workflow limitation and escalate it as a policy question.
