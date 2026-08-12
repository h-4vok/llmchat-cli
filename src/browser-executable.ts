import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type BrowserFamily = 'brave' | 'chromium' | 'chrome';
export type BrowserCandidate = { family: BrowserFamily; path: string };
export type PathExists = (path: string) => boolean;

export function discoverBrowserExecutable(
  candidates: readonly BrowserCandidate[],
  exists: PathExists = existsSync,
): string {
  const executable = candidates.find((candidate) => exists(candidate.path));
  if (executable) return executable.path;
  throw new Error('No supported browser found. Install Brave or Chromium/Chrome and try again.');
}

export function browserCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  managedChromium?: string,
): BrowserCandidate[] {
  if (platform === 'win32') return windowsCandidates(env, managedChromium);
  if (platform === 'darwin') return macCandidates(managedChromium);
  return linuxCandidates(managedChromium);
}

function windowsCandidates(env: NodeJS.ProcessEnv, managed?: string): BrowserCandidate[] {
  const programFiles = env.PROGRAMFILES ?? 'C:\\Program Files';
  const local = env.LOCALAPPDATA ?? '';
  return compact([
    {
      family: 'brave',
      path: join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    },
    managed && { family: 'chromium', path: managed },
    { family: 'chrome', path: join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { family: 'chrome', path: join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') },
  ]);
}

function macCandidates(managed?: string): BrowserCandidate[] {
  return compact([
    { family: 'brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
    managed && { family: 'chromium', path: managed },
    { family: 'chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  ]);
}

function linuxCandidates(managed?: string): BrowserCandidate[] {
  return compact([
    { family: 'brave', path: '/usr/bin/brave-browser' },
    { family: 'brave', path: '/usr/bin/brave' },
    managed && { family: 'chromium', path: managed },
    { family: 'chromium', path: '/usr/bin/chromium' },
    { family: 'chrome', path: '/usr/bin/google-chrome' },
  ]);
}

function compact(values: Array<BrowserCandidate | '' | undefined>): BrowserCandidate[] {
  return values.filter((value): value is BrowserCandidate => Boolean(value));
}
