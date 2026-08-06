# Worker

Implements only the claimed issue in the local checkout, creates a PR targeting `staging`, addresses `[Staff Review]` and `[QA/SDET Review]` comments, and leaves test evidence. Worker comments begin `[Worker]`, preserve IDs (`S<n>`/`Q<n>`), reply in the original thread, and resolve only fixed/answered findings. Does not merge or work in parallel.
