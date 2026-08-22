import { runCliProcess } from '../dist/cli-app.js';
import { providerStoragePaths } from '../dist/data-path.js';
import { createOutput } from '../dist/output.js';
import { createFakeChatRuntime } from './fake-chat-runtime.mjs';

const output = createOutput({
  write: (line) => process.stdout.write(`${line}\n`),
});
const runtime = createFakeChatRuntime(providerStoragePaths);

process.exitCode = await runCliProcess(process.argv.slice(2), output, runtime);
