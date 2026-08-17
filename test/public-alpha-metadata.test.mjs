import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

test('public alpha metadata keeps the project private and source-only', () => {
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');

  assert.match(packageJson.description, /experimental alpha/i);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.engines.node, '>=22');
  assert.equal(packageJson.repository.url, 'https://github.com/h-4vok/llmchat-cli.git');
  assert.equal(packageJson.bugs.url, 'https://github.com/h-4vok/llmchat-cli/issues');
  assert.equal(packageJson.homepage, 'https://github.com/h-4vok/llmchat-cli');
  assert.match(license, /^MIT License/m);
  assert.match(license, /WITHOUT WARRANTY OF ANY KIND/);
});

test('README states the alpha boundaries and local-only installation', () => {
  assert.match(readme, /Experimental personal alpha/);
  assert.match(readme, /no official .* package published on npm/i);
  assert.match(readme, /CAPTCHA, login, and account verification.*human intervention/i);
  assert.match(readme, /no availability, compatibility, stability, or support guarantee/i);
  assert.match(readme, /disable-blink-features=AutomationControlled/);
  assert.match(readme, /npm run uninstall:global/);
  assert.match(readme, /llmchat config set-default-provider gemini/);
  assert.match(readme, /llmchat auth gemini/);
  assert.match(readme, /llmchat chat/);
  assert.match(readme, /llmchat health gemini/);
});
