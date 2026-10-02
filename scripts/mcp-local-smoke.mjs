import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const command = process.platform === 'win32' ? 'llmchat-mcp-wrapper.cmd' : 'llmchat-mcp-wrapper';
const transport = new StdioClientTransport({ command });
const client = new Client({ name: 'llmchat-local-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  console.log(`TOOLS=${listed.tools.map(({ name }) => name).join(',')}`);
  const result = await client.callTool({
    name: 'chat',
    arguments: { provider: 'demo', prompt: 'decí exactamente MCP ok' },
  });
  console.log(`RESULT=${JSON.stringify(result.structuredContent)}`);
  process.exitCode = result.isError ? 1 : 0;
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
}
