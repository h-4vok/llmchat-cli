---
name: consult-llm
description: Consult Gemini or another implemented LLMChat provider when the user asks for that provider's analysis, second opinion, or issue refinement, including requests such as "preguntale a Gemini" or "usa Gemini para refinar este issue". Use the installed LLMChat MCP; the user need not name LLMChat. Does not apply to developing a Gemini integration or ordinary questions about Gemini.
---

Use the available LLMChat MCP `chat` tool (the subprocess wrapper) or `ask_llm`
(the in-process server). Select `provider: gemini` when Gemini is named. Omit
model and reasoning unless requested. Use a disposable conversation by default.
Preserve requested model variants: "Flash" means Flash, never Flash Lite.
Pass the user's model name; do not guess a different version or substitute a
model after a selection error. Flash and Flash Lite are distinct choices.
Keep `headless: true` (the MCP default); set `headless: false` only when the
user explicitly asks to see the browser. MCP `auth` only checks the session
in a hidden browser; interactive login remains a local terminal action.
Only Gemini and the offline `demo` provider are currently implemented. If the
user names DeepSeek, Claude, or another unavailable provider, explain that it
is not supported yet; do not silently substitute Gemini.

Build a self-contained prompt from the user's request and the relevant material.
Gemini cannot see this Codex conversation, local files, or GitHub issues just
because they were mentioned. For an issue reference, read its actual title,
body, and relevant comments with the available GitHub tools or `gh issue view`.
Send the relevant content, repository context, requested analysis, and desired
output in `prompt`. An issue number or URL alone is insufficient.

Treat the returned provider text as source material. Check it against the issue
and the user's objective. For an analysis request, return the useful findings
with attribution to the provider. For "refine and update issue 25", use those
findings to prepare and apply the authorized GitHub edit through Codex's GitHub
tools or `gh issue edit --body-file`, preserving unrelated scope; report the
issue link and what changed. A request to analyze or draft alone does not
authorize a GitHub edit. The MCP does not itself update GitHub.

Inspect `isError` and the structured status before claiming success or applying
provider-derived edits. If the call fails or the response is incomplete, report
the specific limitation. If a session is required, the user can run
`llmchat auth gemini` in a local terminal; MCP does not open an interactive login.
Do not automatically resend a prompt whose outcome is uncertain.

If LLMChat's tools are missing, identify the missing MCP connection and consult
the local setup guide if available. Do not claim a consultation occurred.
