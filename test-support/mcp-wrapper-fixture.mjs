import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createWrapperServer } from '../packages/mcp-wrapper/src/server.mjs';

export async function connectWrapper(t, run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createWrapperServer({ run });
  const caller = new Client({ name: 'test', version: '1' });
  t.after(() => Promise.all([caller.close(), server.close()]));
  await server.connect(serverTransport);
  await caller.connect(clientTransport);
  return caller;
}

export const success = {
  schemaVersion: 1,
  type: 'result',
  provider: 'demo',
  options: { prompt: 'hello', disposableConversation: true },
  status: 'success',
  response: { text: 'ok' },
};
