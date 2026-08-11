#!/usr/bin/env node
import { runCli } from './cli-app.js';
import { errorMessage } from './error-format.js';

try {
  runCli(process.argv.slice(2));
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
