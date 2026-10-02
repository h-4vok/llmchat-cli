import { spawn } from 'node:child_process';
import { cliInvocation } from './invocation.mjs';
import { parseResult, ProcessProtocolError } from './jsonl-result.mjs';
export { ProcessProtocolError } from './jsonl-result.mjs';

export function createProcessClient(options = {}) {
  const executable = options.executable ?? process.env.LLMCHAT_EXECUTABLE ?? 'llmchat';
  return {
    run: (args, request = {}) =>
      runProcess(executable, args, {
        timeoutMs: options.timeoutMs ?? 300000,
        spawnProcess: options.spawn ?? spawn,
        ...request,
      }),
  };
}

async function runProcess(executable, args, options) {
  if (options.signal?.aborted) throw new ProcessProtocolError('llmchat process cancelled.');
  try {
    return await captureProcess(cliInvocation(executable, args), options);
  } catch (error) {
    throw contextualError(executable, error);
  }
}

function contextualError(executable, error) {
  if (error instanceof ProcessProtocolError) return error;
  return new ProcessProtocolError(`Unable to start llmchat (${executable}): ${error.message}`);
}

function captureProcess(invocation, { timeoutMs, signal, spawnProcess }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, invocation.args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LLMCHAT_NON_INTERACTIVE: '1' },
    });
    let stdout = '';
    let stderr = '';
    let failure;
    const stop = (message) => {
      failure ??= new ProcessProtocolError(message);
      terminate(child);
    };
    const timer = setTimeout(() => stop(`llmchat timed out after ${timeoutMs}ms.`), timeoutMs);
    const abort = () => stop('llmchat process cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      failure = new ProcessProtocolError(`Unable to start llmchat: ${error.message}`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      try {
        resolve(parseResult(stdout, stderr, code));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function terminate(child) {
  if (!child.pid) return;
  if (process.platform !== 'win32') return child.kill();
  const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  killer.on('error', () => child.kill());
}
