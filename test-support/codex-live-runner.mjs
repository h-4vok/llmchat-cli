import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { codexInvocation } from './codex-invocation.mjs';

export function runCodex(prompt, temporaryRoot) {
  const cli = resolve('dist', 'cli.js');
  const overrides = [
    `mcp_servers.llmchat_test.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.llmchat_test.args=${JSON.stringify([cli, 'mcp'])}`,
    'mcp_servers.llmchat_test.required=true',
    'mcp_servers.llmchat_test.default_tools_approval_mode="approve"',
    `mcp_servers.llmchat_test.env=${tomlEnvironment(temporaryRoot)}`,
  ];
  const args = overrides.flatMap((value) => ['-c', value]);
  args.push('--ask-for-approval', 'never');
  args.push(
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--ignore-user-config',
    prompt,
  );
  return captureCodex(codexInvocation(args));
}

function captureCodex(invocation) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCodex(invocation.command, invocation.args);
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(codexFailure('exceeded the 120 second timeout', stdout, stderr));
    }, 120_000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(codexFailure(error.message, stdout, stderr));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(codexFailure(`exited with code ${code}`, stdout, stderr));
      parseEvents(stdout, stderr, resolvePromise, reject);
    });
  });
}

function spawnCodex(command, args) {
  try {
    return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (error) {
    throw codexFailure(error.message, '', '');
  }
}

function parseEvents(stdout, stderr, resolvePromise, reject) {
  try {
    resolvePromise(stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse));
  } catch (error) {
    reject(codexFailure(`emitted invalid JSONL: ${error.message}`, stdout, stderr));
  }
}

function tomlEnvironment(root) {
  return `{ LOCALAPPDATA = ${JSON.stringify(root)}, XDG_CONFIG_HOME = ${JSON.stringify(root)}, XDG_DATA_HOME = ${JSON.stringify(root)} }`;
}

function codexFailure(message, stdout, stderr) {
  return new Error(
    `Unable to run the live Codex MCP test (${message}). Ensure Codex CLI is installed and authenticated.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
  );
}
