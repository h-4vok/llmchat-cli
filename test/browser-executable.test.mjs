import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserCandidates, discoverBrowserExecutable } from '../dist/browser-executable.js';

test('browser discovery prefers Brave before Chromium or Chrome', () => {
  const candidates = [
    { family: 'brave', path: '/b/brave' },
    { family: 'chromium', path: '/c/chromium' },
    { family: 'chrome', path: '/g/chrome' },
  ];
  assert.equal(
    discoverBrowserExecutable(candidates, (path) => path !== '/c/chromium'),
    '/b/brave',
  );
});

test('platform candidates retain Brave-first order with optional managed Chromium', () => {
  const windows = browserCandidates(
    'win32',
    { PROGRAMFILES: 'C:\\Programs', LOCALAPPDATA: 'C:\\Local' },
    'C:\\Managed\\chromium.exe',
  );
  assert.deepEqual(
    windows.map(({ family }) => family),
    ['brave', 'chromium', 'chrome', 'chrome'],
  );
  assert.match(windows[0].path, /Programs.+Brave/);
  assert.equal(browserCandidates('darwin', {}, '/managed/chromium')[1].path, '/managed/chromium');
  assert.equal(browserCandidates('linux', {}, '/managed/chromium')[2].path, '/managed/chromium');
  assert.equal(
    browserCandidates('win32', {}, undefined).some(({ family }) => family === 'chromium'),
    false,
  );
  assert.equal(browserCandidates('darwin', {}, undefined).length, 2);
  assert.equal(browserCandidates('linux', {}, undefined).length, 4);
});

test('browser discovery falls through candidates and fails clearly', () => {
  const candidates = [
    { family: 'brave', path: '/missing/brave' },
    { family: 'chromium', path: '/present/chromium' },
  ];
  assert.equal(
    discoverBrowserExecutable(candidates, (path) => path.includes('present')),
    '/present/chromium',
  );
  assert.throws(
    () => discoverBrowserExecutable(candidates, () => false),
    /Brave or Chromium\/Chrome/,
  );
});
