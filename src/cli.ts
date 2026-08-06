#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Options = { provider: string; login: boolean; prompt?: string };

function parseArgs(argv: string[]): Options {
  let provider = 'gemini';
  let login = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') provider = argv[++i] ?? '';
    else if (argv[i] === '--login') login = true;
    else if (argv[i] === '--help' || argv[i] === '-h') { console.error('Usage: llmchat [--provider gemini] [--login] "prompt"'); process.exit(0); }
    else rest.push(argv[i]);
  }
  return { provider, login, prompt: rest.join(' ').trim() || undefined };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.provider !== 'gemini') throw new Error(`Provider not implemented: ${options.provider}`);
  if (!options.login && !options.prompt) throw new Error('A prompt is required (or use --login).');
  const profile = join(homedir(), '.llmchat-cli', 'profiles', 'gemini');
  mkdirSync(profile, { recursive: true });
  console.error(`[gemini] using persistent profile ${profile}`);
  const context = await chromium.launchPersistentContext(profile, { headless: !options.login });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
    if (options.login) { console.error('[gemini] complete login in the browser, then press Enter here'); await new Promise<void>(resolve => process.stdin.once('data', () => resolve())); return; }
    const prompt = page.locator('textarea').first();
    await prompt.fill(options.prompt!);
    await prompt.press('Enter');
    const response = page.locator('[data-message-author-role="model"]').last();
    await response.waitFor({ state: 'visible', timeout: 120000 });
    process.stdout.write((await response.innerText()).trim() + '\n');
  } finally { await context.close(); }
}

main().catch(error => { console.error(`[error] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
