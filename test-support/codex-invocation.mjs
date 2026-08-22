import { existsSync } from 'node:fs';
import { extname, win32 } from 'node:path';

export function codexInvocation(args, options) {
  const context = {
    env: process.env,
    exists: existsSync,
    node: process.execPath,
    override: process.env.CODEX_BIN,
    platform: process.platform,
    ...options,
  };
  if (context.override) return explicitInvocation(context.override, args, context);
  if (context.platform !== 'win32') return { command: 'codex', args };
  const shim = findWindowsShim(context);
  if (!shim) throw missingWindowsCodex();
  return npmShimInvocation(shim, args, context);
}

function explicitInvocation(command, args, context) {
  const extension = extname(command).toLowerCase();
  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return { command: context.node, args: [command, ...args] };
  }
  if (context.platform === 'win32' && ['.cmd', '.bat'].includes(extension)) {
    return npmShimInvocation(command, args, context);
  }
  return { command, args };
}

function findWindowsShim(context) {
  const pathValue = context.env.PATH ?? context.env.Path ?? '';
  const candidates = pathValue
    .split(';')
    .filter(Boolean)
    .map((directory) => win32.join(directory, 'codex.cmd'));
  return candidates.find(context.exists);
}

function npmShimInvocation(shim, args, context) {
  const entrypoint = win32.join(
    win32.dirname(shim),
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  if (!context.exists(entrypoint)) throw missingWindowsCodex();
  return { command: context.node, args: [entrypoint, ...args] };
}

function missingWindowsCodex() {
  return new Error(
    'Unable to resolve a safe Codex executable on Windows. Set CODEX_BIN to codex.exe, codex.js, or the npm codex.cmd shim.',
  );
}
