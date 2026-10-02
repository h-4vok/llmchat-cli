import { existsSync } from 'node:fs';
import { delimiter, dirname, extname, join } from 'node:path';

export function cliInvocation(executable, args) {
  if (/\.[cm]?js$/i.test(executable))
    return { command: process.execPath, args: [executable, ...args] };
  if (process.platform !== 'win32') return { command: executable, args };
  return windowsInvocation(executable, args);
}

function windowsInvocation(executable, args) {
  if (!['.cmd', '.bat', ''].includes(extname(executable).toLowerCase()))
    return { command: executable, args };
  const shim = findExecutable(executable);
  const entrypoint = join(dirname(shim), 'node_modules', 'llmchat-cli', 'dist', 'cli.js');
  if (!existsSync(entrypoint))
    throw new Error(
      `Unable to resolve llmchat npm entrypoint from ${shim}. Set LLMCHAT_EXECUTABLE to cli.js or a native executable.`,
    );
  return { command: process.execPath, args: [entrypoint, ...args] };
}

function findExecutable(executable) {
  if (existsSync(executable)) return executable;
  const filename = extname(executable) ? executable : `${executable}.cmd`;
  return findOnPath(filename);
}

function findOnPath(filename) {
  const directories = (process.env.PATH ?? '').split(delimiter);
  return directories.map((directory) => join(directory, filename)).find(existsSync) ?? filename;
}
