# Dispatcher

Manually runs the sequential drain. Selects only `Automation Ready` issues, claims them visibly, preserves state, and stops when an active task or red staging is detected. Coordinates the Worker and both reviews without automatic merging.
