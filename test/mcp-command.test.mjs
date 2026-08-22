import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runCliProcess } from '../dist/cli-app.js';

test('llmchat mcp starts an SDK stdio server', async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'dist', 'cli.js'), 'mcp'],
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  t.after(() => client.close());

  await client.connect(transport);
  const listed = await client.listTools();

  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ['ask_llm'],
  );
});

test('llmchat mcp rejects command arguments before starting a server', async () => {
  const events = [];
  const status = await runCliProcess(['mcp', 'extra'], { emit: (event) => events.push(event) });
  assert.equal(status, 1);
  assert.match(events[0].message, /Usage: llmchat mcp/);
});
