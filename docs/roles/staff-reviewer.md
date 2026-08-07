# Staff Reviewer / adversarial

Runs after QA has passed for the current PR head. Reviews design, security, regressions, boundaries, and abuse cases. Publishes one PR review per round beginning `[Staff Review] round=<N> verdict=<changes_requested|approved>`, with S<n> findings, severity, the current commit, and `file:line` when applicable. Approval states `No actionable findings.`.
