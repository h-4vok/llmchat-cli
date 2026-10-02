import type { ChatRuntime } from './chat-runtime.js';
import { printConfigHelp } from './cli-help.js';
import { adminFormat, emitAdmin } from './admin-output.js';
import { removeDefaultProvider, resolveConfig, saveDefaultProvider } from './config.js';
import { messages } from './config/messages.js';
import type { Output } from './output.js';
import { resolveProvider } from './provider-selection.js';
import type { BrowserSessionResult } from './browser-session.js';
import { withRuntimeContext } from './runtime-context.js';

export function runConfig(args: string[], output: Output): void {
  const parsed = adminFormat(args);
  args = parsed.args;
  if (isConfigHelp(args)) return printConfigHelp(output);
  if (isConfigRead(args)) return emitConfigRead(output, parsed.format);
  configAction(args)(args);
  emitAdmin(output, 'config', resolveConfig(), parsed.format);
}
function emitConfigRead(output: Output, format: ReturnType<typeof adminFormat>['format']): void {
  const config = resolveConfig();
  if (format === 'text') {
    output.emit({ speaker: 'llmchat', message: JSON.stringify(config, null, 2) });
    return;
  }
  emitAdmin(output, 'config', config, format);
}
function isConfigHelp(args: string[]): boolean {
  return !args.length || ['--help', '-h'].includes(args[0]);
}
function isConfigRead(args: string[]): boolean {
  return args[0] === 'read' && args.length === 1;
}
function configAction(args: string[]): (args: string[]) => void {
  const action = {
    'clear-default-provider': clearDefaultProvider,
    'set-default-provider': setDefaultProvider,
  }[args[0]];
  if (!action) throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  return action;
}
function setDefaultProvider(args: string[]): void {
  if (args.length !== 2)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  saveDefaultProvider(resolveProvider(args[1]));
}
function clearDefaultProvider(args: string[]): void {
  if (args.length !== 1)
    throw new Error('Invalid config command. Use "llmchat config --help" for usage.');
  removeDefaultProvider();
}

export async function runAuth(args: string[], output: Output, runtime: ChatRuntime): Promise<void> {
  const parsed = adminFormat(args);
  args = parsed.args;
  if (args.length !== 1) throw new Error('Usage: llmchat auth <provider>.');
  const provider = resolveProvider(args[0]);
  if (runtime.capabilitiesFor?.(provider).authentication === 'none') {
    output.emit({
      speaker: 'llmchat',
      message: `Provider ${provider} does not require authentication.`,
    });
    return emitAdmin(output, 'auth', { provider }, parsed.format);
  }
  await withRuntimeContext(runtime, provider, async (context) => {
    const result = await authenticate(runtime, provider, context);
    emitAuthSuccess(output, result);
    emitAdmin(output, 'auth', { provider, status: result?.status ?? 'unknown' }, parsed.format);
  });
}
async function authenticate(
  runtime: ChatRuntime,
  provider: string,
  context: ReturnType<ChatRuntime['contextFor']>,
) {
  const result = await getSession(runtime, provider, context);
  validateAuthResult(result, provider);
  return result;
}

function getSession(
  runtime: ChatRuntime,
  provider: string,
  context: ReturnType<ChatRuntime['contextFor']>,
) {
  return runtime.ensureSession?.(provider, context, {
    visible: true,
    interactive: process.env.LLMCHAT_NON_INTERACTIVE !== '1',
  });
}

function validateAuthResult(result: BrowserSessionResult | undefined, provider: string): void {
  const failures: Record<string, string> = {
    'authentication-required': `Provider ${provider} requires authentication. Run "llmchat auth ${provider}" in a local terminal.`,
    indeterminate: messages.geminiLoginRequired,
    cancelled: `${provider} authentication was cancelled.`,
  };
  const message = failures[result?.status ?? ''];
  if (message) throw new Error(message);
}
function emitAuthSuccess(output: Output, result: BrowserSessionResult | undefined): void {
  if (result?.status !== 'ready') return;
  output.emit({
    speaker: 'llmchat',
    message:
      result.source === 'reused' ? messages.auth.sessionReused : messages.auth.sessionAuthenticated,
  });
}

export async function runHealth(
  args: string[],
  output: Output,
  runtime: ChatRuntime,
): Promise<void> {
  const parsed = adminFormat(args);
  args = parsed.args;
  if (args.length !== 1) throw new Error('Usage: llmchat health <provider>.');
  const provider = resolveProvider(args[0]);
  await withRuntimeContext(runtime, provider, async (context) => {
    const health = await runtime.adapterFor(provider).checkHealth(context);
    emitHealth(health, provider, output, parsed.format);
  });
}
function emitHealth(
  health: Awaited<ReturnType<ReturnType<ChatRuntime['adapterFor']>['checkHealth']>>,
  provider: string,
  output: Output,
  format: ReturnType<typeof adminFormat>['format'],
): void {
  if (health.status === 'broken') throw new Error(health.message);
  output.emit({ speaker: 'llmchat', message: health.message });
  emitAdmin(output, 'health', { provider, status: health.status, message: health.message }, format);
}
