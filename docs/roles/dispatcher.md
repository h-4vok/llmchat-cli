# Dispatcher

Runs the sequential drain in the foreground. Selects only `Automation Ready` issues, claims them visibly, persists each phase, polls required PR checks, and coordinates Worker → QA/SDET → Staff without automatic merging. If a Worker PID disappears or its lease expires, it reconstructs the existing PR context and starts a replacement Worker. It never runs `npm test` locally and never treats stdout or JSON as review evidence.
