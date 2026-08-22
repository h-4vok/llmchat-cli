import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ChatRuntime } from './chat-runtime.js';
import { createMcpServer } from './mcp-server.js';

export async function startMcpServer(runtime: ChatRuntime): Promise<void> {
  const server = createMcpServer({ runtime });
  await server.connect(new StdioServerTransport());
}
