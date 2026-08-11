#!/usr/bin/env node
import { runCliProcess } from './cli-app.js';
import { createOutput } from './output.js';

const output = createOutput({
  write: (line) => process.stdout.write(`${line}\n`),
});

process.exitCode = await runCliProcess(process.argv.slice(2), output);
