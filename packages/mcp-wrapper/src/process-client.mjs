import { spawn } from 'node:child_process';

export class ProcessProtocolError extends Error {}

const defaultExecutable = process.platform === 'win32' ? 'llmchat.cmd' : 'llmchat';

export function createProcessClient({
  executable = process.env.LLMCHAT_EXECUTABLE ?? defaultExecutable,
  timeoutMs = 120000,
} = {}) {
  return { run: (args, options = {}) => runProcess(executable, args, { timeoutMs, ...options }) };
}

function runProcess(executable, args, { timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (fn, value) => {
      if (!settled) {
        settled = true;
        fn(value);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new ProcessProtocolError(`llmchat timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const abort = () => {
      child.kill();
      finish(reject, new ProcessProtocolError('llmchat process cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) =>
      finish(reject, new ProcessProtocolError(`Unable to start llmchat: ${error.message}`)),
    );
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        finish(resolve, parseResult(stdout, stderr, code));
      } catch (error) {
        finish(reject, error);
      }
    });
  });
}

function parseResult(stdout, stderr, code) {
  const records = stdout.trim() ? stdout.trim().split(/\r?\n/).map(parseLine) : [];
  const terminal = records.at(-1);
  if (!terminal || terminal.type !== 'result')
    throw new ProcessProtocolError(
      `llmchat returned no terminal JSONL record.${stderr ? ` stderr: ${stderr.trim()}` : ''}`,
    );
  if (terminal.schemaVersion !== 1)
    throw new ProcessProtocolError(`Unsupported llmchat schemaVersion: ${terminal.schemaVersion}.`);
  if (code !== 0)
    throw new ProcessProtocolError(
      `llmchat exited with code ${code}.${stderr ? ` stderr: ${stderr.trim()}` : ''}`,
    );
  return terminal;
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new ProcessProtocolError(`Invalid llmchat JSONL record: ${line}`);
  }
}
