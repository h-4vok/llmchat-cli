# llmchat-cli

CLI foundation for provider-backed chat. The MVP uses a deterministic simulation so it can be used and tested without network access; successful output goes to `stdout` and errors go to `stderr`.

## MVP

- Supported provider: `gemini`.
- The selected default is stored in the user-local configuration directory (`$XDG_CONFIG_HOME/llmchat/config.json`, or the platform equivalent).
- Real provider requests, authentication, streaming, and additional providers are planned for later phases.

## Usage

```text
llmchat config set-default-provider gemini
llmchat chat "Explain what an API is in one sentence"
llmchat chat "Explain what an API is" --provider gemini
llmchat config clear-default-provider
```

Use `llmchat --help` and `llmchat config --help` for command usage and supported values. A provider can be passed before or after the prompt; the canonical form is `llmchat chat "<prompt>" --provider <provider>`.

## Development

```text
npm install
npm run build
npm test
```

To install the current checkout as the global `llmchat` command while developing:

```text
npm run install:global
llmchat --help
llmchat chat --provider gemini "hello"
```

Remove the global development link with `npm run uninstall:global`.

This repository contains the skeleton and the first end-to-end Gemini route. Open decisions are tracked as GitHub issues.
