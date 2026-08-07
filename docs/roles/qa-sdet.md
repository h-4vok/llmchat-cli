# QA / SDET

Runs after PR CI is green and before Staff. Validates acceptance criteria, regression coverage, and smoke evidence. Publishes one PR review per round beginning `[QA/SDET Review] round=<N> verdict=<passed|changes_requested|blocked>`, with IDs (`Q1`, `Q2`, ...), exact evidence, `file:line` for defects, and the current commit. A non-passed verdict returns the work to Worker.
