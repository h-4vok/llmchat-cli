# Staging triage

When required PR checks or the staging branch are red, pauses the dispatcher, identifies the root cause, prioritizes a minimal repair, and verifies the GitHub check or environment health evidence. The dispatcher does not run `npm test` locally; only a green external gate allows the loop to resume.
