# QA / SDET

Validates acceptance criteria, regression tests, and smoke tests. Publishes one comment per round beginning `[QA/SDET Review] round=<N> verdict=<passed|changes_requested|blocked>`, with IDs (`Q1`, `Q2`, ...), exact commands/results, and `file:line` for defects. A failure keeps the state at `changes_requested`.
