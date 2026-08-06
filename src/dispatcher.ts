#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Status =
  | 'queued'
  | 'claimed'
  | 'in_progress'
  | 'reviewing'
  | 'changes_requested'
  | 'qa_pending'
  | 'ready_to_merge'
  | 'blocked'
  | 'done';
type State = {
  issue?: number;
  status?: Status;
  pr?: number;
  reviewRound?: number;
  stagingGreen?: boolean;
};
const root = process.cwd();
const stateDir = join(root, '.llmchat');
const stateFile = join(stateDir, 'state.json');
const configFile = join(root, 'loop.config.json');

function run(args: string[]): string {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function load(): State {
  return existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
}
function save(state: State): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}
function comment(issue: number, body: string): void {
  run(['issue', 'comment', String(issue), '--body', body]);
}
function setStatus(issue: number, status: Status, extra: Partial<State> = {}): void {
  const state = { ...load(), issue, status, ...extra };
  save(state);
  comment(
    issue,
    'Loop engineering v1: estado ' +
      status +
      '.\\n\\nDispatcher local; no se hace merge automático.',
  );
}
function config(): Record<string, any> {
  return existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
}

function eligible(): Array<{ number: number; title: string }> {
  return JSON.parse(
    run([
      'issue',
      'list',
      '--state',
      'open',
      '--label',
      'Automation Ready',
      '--json',
      'number,title',
      '--limit',
      '100',
    ]),
  ).sort((a: any, b: any) => a.number - b.number);
}
function main(): void {
  const args = process.argv.slice(2);
  const cfg = config();
  const state = load();
  if (state.status && !['done', 'blocked', 'ready_to_merge'].includes(state.status))
    throw new Error(
      `active run exists for issue #${state.issue} (${state.status}); recover or clear ${stateFile}`,
    );
  if (args.includes('--status')) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (args.includes('--list')) {
    console.log(JSON.stringify(eligible(), null, 2));
    return;
  }
  if (state.stagingGreen === false)
    throw new Error('staging is red; dispatcher paused until triage marks it green');
  const issue = eligible()[0];
  if (!issue) {
    console.error('No eligible issues.');
    return;
  }
  setStatus(issue.number, 'claimed');
  comment(
    issue.number,
    `Dispatcher reclama esta issue para ejecución secuencial. Worker configurado: ${cfg.workerCommand ?? 'manual/Codex task'}.`,
  );
  setStatus(issue.number, 'in_progress');
  if (cfg.workerCommand)
    execFileSync(cfg.workerCommand, [String(issue.number)], { cwd: root, stdio: 'inherit' });
  else
    console.error(
      'Worker no configurado; prepara el worker Codex manualmente y vuelve a ejecutar con loop.config.json.',
    );
  setStatus(issue.number, 'reviewing', { reviewRound: 1 });
  console.error(
    'PR/revisiones se coordinan mediante los comandos configurados; nunca se hace merge automático.',
  );
}
try {
  main();
} catch (error) {
  console.error(`[dispatcher] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
