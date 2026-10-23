# Gemini UI drift monitor

## Purpose

Check Gemini's visible model and thinking-level controls each morning in the
authenticated Brave session. The monitor never submits a prompt. Authentication
stays in the local browser profile and is never copied into this repository.

The observed menu baseline is:

- Models: `3.5 Flash-Lite`, `3.8 Flash`, `3.1 Pro`, `4 Argon`.
- Thinking level: `Low`, `Medium`, `High`.
- The model picker is exposed as `Open mode picker`.
- The nested reasoning control is exposed as `Thinking level`.

Treat menu descriptions as useful evidence, not stable identifiers. Model and
reasoning options are identified by their visible menu-item names.

## Daily read-only check

1. Use the user's open Brave session and navigate a new tab to
   `https://gemini.google.com/app`.
2. Confirm the signed-in account marker is present. If Gemini asks for sign-in,
   stop and report that manual authentication is needed. Do not enter
   credentials or use another account.
3. Open `Open mode picker` and read all visible model menu items.
4. Open `Thinking level` and read all visible level menu items.
5. Compare the available controls and labels with the baseline and the current
   selectors in `src/config/gemini.ts` and `src/gemini-playwright-page.ts`.
6. Close the menus. Do not choose a different model or level, create a chat,
   type a prompt, or submit anything.

Keep the report limited to the selector state, model names, reasoning names,
date, and outcome. Do not record account details, chat titles, prompts,
responses, page HTML, or screenshots containing unrelated user data.

## Drift and pull request workflow

1. Before editing, inspect open pull requests for this monitor. If one is open,
   report its link and stop. Do not create another branch or pull request until
   the existing one is closed or merged.
2. For new drift, create a dated branch named
   `codex/gemini-ui-drift-YYYY-MM-DD` from the current default branch.
3. Update the Gemini selectors or behavior and the deterministic UI fixtures to
   match only controls observed in Brave. Keep live browser access out of tests
   and CI; fixtures must remain self-contained and offline.
4. Add a regression test for the observed change, then run `npm run check`.
5. Request a fresh read-only review using the `llmchat-qa-gate` skill. Fix any
   `REQUEST CHANGES` findings before opening a pull request.
6. Open one pull request with the observed UI labels, failure evidence, code
   changes, and check results. Never merge it automatically.
7. If no drift is found, leave the repository unchanged and stay quiet. Report
   only a meaningful UI change, a blocked check, or a new pull request.
