import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ChatRuntime } from './chat-runtime.js';
import { executeChatWithContext } from './chat-execution.js';
import { resolveConfig } from './config.js';
import { askLlmInput, askLlmOutput, mcpInstructions, mcpResult } from './mcp-contract.js';
import { resolveProvider } from './provider-selection.js';
import { defaultProvider } from './supported-providers.js';

export type McpConfigPort = { read(): Record<string, unknown> };
type McpDependencies = { runtime: ChatRuntime; config?: McpConfigPort };

export function createMcpServer(dependencies: McpDependencies): McpServer {
  const server = new McpServer(
    { name: 'llmchat', version: '1.0.0' },
    { instructions: mcpInstructions },
  );
  registerAskLlm(server, dependencies.runtime, dependencies.config ?? { read: resolveConfig });
  return server;
}

function registerAskLlm(server: McpServer, runtime: ChatRuntime, config: McpConfigPort): void {
  server.registerTool(
    'ask_llm',
    {
      title: 'Ask an LLM',
      description:
        'Ask or consult an external LLM such as Gemini through LLMChat and return its canonical response.',
      inputSchema: askLlmInput,
      outputSchema: askLlmOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const provider = resolveMcpProvider(input.provider, config);
      const transcript = await executeChatWithContext({
        runtime,
        provider,
        request: {
          prompt: input.prompt,
          model: input.model,
          reasoning: input.reasoning,
          disposableConversation: input.disposableConversation,
        },
        keepBrowserOpen: false,
        sessionOptions: { interactive: false },
      });
      return mcpResult(transcript);
    },
  );
}

function resolveMcpProvider(requested: string | undefined, config: McpConfigPort) {
  if (requested) return resolveProvider(requested);
  const configured = config.read().defaultProvider;
  return resolveProvider(typeof configured === 'string' ? configured : defaultProvider);
}
