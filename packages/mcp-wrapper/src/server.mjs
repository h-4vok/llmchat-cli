import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { createProcessClient } from './process-client.mjs';

const provider = z.string().optional();
const common = { provider: provider.describe('Provider name.') };

export function createWrapperServer(client = createProcessClient()) {
  const server = new McpServer({ name: 'llmchat-mcp-wrapper', version: '1.0.0' });
  const invoke = (args, extra) =>
    client.run(args, { signal: extra.signal }).then(result).catch(failure);
  server.registerTool(
    'chat',
    {
      title: 'Chat',
      inputSchema: {
        prompt: z.string().min(1),
        ...common,
        model: z.string().optional(),
        reasoning: z.string().optional(),
        systemInstructions: z.string().optional(),
        disposableConversation: z.boolean().optional(),
        outputFormat: z.enum(['text', 'json', 'jsonl', 'yaml']).optional(),
      },
    },
    async (input, extra) => invoke(chatArgs(input), extra),
  );
  server.registerTool(
    'health',
    { title: 'Health', inputSchema: { provider: z.string() } },
    async (input, extra) => invoke(adminArgs('health', input), extra),
  );
  server.registerTool(
    'auth',
    { title: 'Auth', inputSchema: { provider: z.string() } },
    async (input, extra) => invoke(adminArgs('auth', input), extra),
  );
  server.registerTool(
    'config',
    {
      title: 'Config',
      inputSchema: {
        action: z.enum(['read', 'set-default-provider', 'clear-default-provider']),
        provider: z.string().optional(),
      },
    },
    async (input, extra) => {
      if (input.action !== 'read' && !input.provider)
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
  return ['chat', input.prompt, ...flags(input)];
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
function result(record) {
  const text = record.response?.text ?? record.error?.message ?? JSON.stringify(record);
  return {
    content: [{ type: 'text', text }],
    structuredContent: record,
    ...(record.status === 'failure' ? { isError: true } : {}),
  };
}
function failure(error) {
  const record = {
    schemaVersion: 1,
    type: 'result',
    status: 'failure',
    error: { code: 'CHAT_FAILED', message: error.message },
  };
  return {
    content: [{ type: 'text', text: error.message }],
    structuredContent: record,
    isError: true,
  };
}
