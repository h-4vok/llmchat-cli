# Worker

Implements only the claimed issue in the local checkout, creates or updates one PR targeting `staging`, addresses `[QA/SDET Review]` before `[Staff Review]`, and leaves reproducible evidence. Worker comments begin `[Worker]` and include the round, PR, base, and current commit. A recovery Worker continues the existing PR and never creates a second PR or merges.
