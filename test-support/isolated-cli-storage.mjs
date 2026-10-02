import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const keys = ['LOCALAPPDATA', 'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];

export async function isolateCliStorage(t) {
  const root = await mkdtemp(join(tmpdir(), 'llmchat-test-storage-'));
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = root;
  t.after(async () => {
    restoreEnvironment(previous);
    await rm(root, { recursive: true, force: true });
  });
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
