# llmchat MCP wrapper

Standalone stdio MCP facade. It starts `llmchat` as a child process and consumes
only its versioned JSONL output. Set `LLMCHAT_EXECUTABLE` to override the
executable (the default is `llmchat`).

From the repository root, run `npm run install:global`. This makes
`llmchat-mcp-wrapper` available in the PATH for MCP hosts.
