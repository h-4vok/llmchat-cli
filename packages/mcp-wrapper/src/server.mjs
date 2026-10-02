import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { createProcessClient } from './process-client.mjs';

import { instructions, provider, chatInput, mcpResult, failure } from './tool-contract.mjs';

export function createWrapperServer(client = createProcessClient()) {
  const server = new McpServer({ name: 'llmchat-mcp-wrapper', version: '1.0.0' }, { instructions });
  const invoke = (args, extra, format) =>
    client
      .run(args, { signal: extra.signal })
      .then((record) => mcpResult(record, format))
      .catch((error) => failure(error, format));
  server.registerTool(
    'chat',
    {
      title: 'Consult an external LLM',
      description:
        'Ask Gemini through LLMChat when the user requests Gemini analysis, a second opinion, or GitHub issue refinement. Send the actual context in prompt. Returns the provider response for Codex to use in the requested workflow. Supports gemini and offline demo; authentication must already exist.',
      inputSchema: chatInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => invoke(chatArgs(input), extra, input.outputFormat),
  );
  server.registerTool(
    'health',
    {
      title: 'Health',
      description:
        'Check provider availability without sending a prompt. Gemini checks its browser UI; demo is offline.',
      inputSchema: { provider },
    },
    async (input, extra) => invoke(adminArgs('health', input), extra),
  );
  server.registerTool(
    'auth',
    {
      title: 'Auth',
      description:
        'Check an existing provider session without opening an interactive login. If authentication is needed, run llmchat auth gemini manually in a local terminal.',
      inputSchema: { provider },
    },
    async (input, extra) => invoke(adminArgs('auth', input), extra),
  );
  server.registerTool(
    'config',
    {
      title: 'Config',
      description:
        'Read CLI configuration or explicitly change or clear the default provider. Changing configuration affects later calls that omit provider.',
      inputSchema: {
        action: z.enum(['read', 'set-default-provider', 'clear-default-provider']),
        provider: provider.optional(),
      },
    },
    async (input, extra) => {
      if (input.action === 'set-default-provider' && !input.provider)
        return failure(new Error('config provider is required for this action.'));
      return invoke(configArgs(input), extra);
    },
  );
  return server;
}

export async function startWrapper() {
  const server = createWrapperServer();
  await server.connect(new StdioServerTransport());
}
function chatArgs(input) {
  return ['chat', ...flags(input), '--', input.prompt];
}
function flags(input) {
  return Object.entries({
    provider: input.provider,
    model: input.model,
    reasoning: input.reasoning,
    'system-instructions': input.systemInstructions,
    output: 'jsonl',
  })
    .flatMap(([key, value]) => (value === undefined ? [] : [`--${key}`, String(value)]))
    .concat(input.disposableConversation ? ['--disposable-conversation'] : []);
}
function adminArgs(command, input) {
  return [command, input.provider, '--output', 'jsonl'];
}
function configArgs(input) {
  if (input.action === 'read') return ['config', 'read', '--output', 'jsonl'];
  if (input.action === 'clear-default-provider')
    return ['config', input.action, '--output', 'jsonl'];
  return ['config', input.action, input.provider, '--output', 'jsonl'];
}
