import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createOutput, palette } from '../dist/output.js';
import { run, runProduction } from '../test-support/cli-helper.mjs';

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

test('visual output aligns labels, timestamps every line, and keeps color active', () => {
  const lines = [];
  const output = createOutput({
    write: (line) => lines.push(line),
    now: () => new Date(2026, 7, 11, 9, 7),
  });

  output.emit({ speaker: 'gemini', message: 'first\nsecond' });
  output.emit({ speaker: 'chatgpt', message: 'warm' });
  output.emit({ speaker: 'llmchat', tone: 'warning', message: 'careful' });
  output.emit({ speaker: 'gemini', tone: 'error', message: 'failed' });

  assert.deepEqual(
    lines.map((line) => line.replace(ansi, '')),
    [
      'GEMINI  ## [09:07] first',
      'GEMINI  ## [09:07] second',
      'CHATGPT ## [09:07] warm',
      'LLMCHAT ## [09:07] careful',
      'GEMINI  ## [09:07] failed',
    ],
  );
  assert.ok(lines[0].startsWith(palette.blue));
  assert.ok(lines[2].startsWith(palette.terracotta));
  assert.ok(lines[3].startsWith(palette.amber));
  assert.ok(lines[4].startsWith(palette.red));
  assert.ok(lines.every((line) => line.endsWith(palette.reset)));
});

test('the central registry can add interlocutors without changing the formatter', () => {
  const lines = [];
  const output = createOutput({
    write: (line) => lines.push(line),
    now: () => new Date(2026, 7, 11, 9, 7),
    speakers: { future: { label: 'FUTURE', color: palette.blue } },
  });

  output.emit({ speaker: 'future', message: 'hello' });

  assert.equal(lines[0].replace(ansi, ''), 'FUTURE ## [09:07] hello');
  assert.throws(
    () => output.emit({ speaker: 'missing', message: 'hello' }),
    /Unknown output speaker/,
  );
});

test('CLI success and failure share stdout with exit codes 0 and 1', () => {
  const home = mkdtempSync(join(tmpdir(), 'llmchat-output-'));
  const success = run(home, 'chat', '--provider', 'gemini', 'hello');
  const failure = run(home, 'unknown');

  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  assert.match(success.stdout.replace(ansi, ''), /^GEMINI {2}## \[\d{2}:\d{2}\] .*hello\n$/);
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr, '');
  assert.match(failure.stdout.replace(ansi, ''), /^LLMCHAT ## \[\d{2}:\d{2}\] \[error\]/);
  assert.ok(failure.stdout.startsWith(palette.red));
  assert.equal(runProduction(home, '--help').status, 0);
});
