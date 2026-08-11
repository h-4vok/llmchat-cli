import { homedir, platform as runtimePlatform } from 'node:os';
import { isAbsolute, join, posix, win32, type PlatformPath } from 'node:path';

export type DataPathInput = {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
};

export type ProviderStoragePaths = {
  root: string;
  profileDirectory: string;
  logsDirectory: string;
  diagnosticsDirectory: string;
  screenshotsDirectory: string;
};

type RootResolver = (input: DataPathInput) => string;

const platformRoots: Partial<Record<NodeJS.Platform, RootResolver>> = {
  darwin: macosRoot,
  win32: windowsRoot,
};

export function dataRoot(input = runtimeDataPathInput()): string {
  const platformRoot = (platformRoots[input.platform] ?? unixRoot)(input);
  validateDataRoot(platformRoot, input.platform);
  return join(platformRoot, 'llmchat');
}

export function providerStoragePaths(
  provider: string,
  input = runtimeDataPathInput(),
): ProviderStoragePaths {
  validateProviderIdentifier(provider);
  const root = dataRoot(input);
  return {
    root,
    profileDirectory: join(root, 'profiles', provider),
    logsDirectory: join(root, 'logs', provider),
    diagnosticsDirectory: join(root, 'diagnostics', provider),
    screenshotsDirectory: join(root, 'screenshots', provider),
  };
}

export function runtimeDataPathInput(): DataPathInput {
  return { env: process.env, home: homedir(), platform: runtimePlatform() };
}

function validateProviderIdentifier(provider: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new Error(`Invalid provider identifier "${provider}".`);
  }
}

function validateDataRoot(root: string, platform: NodeJS.Platform): void {
  if (!root || root !== root.trim() || !isAbsoluteForPlatform(root, platform)) {
    throw new Error(`Expected an absolute local data path, received "${root}".`);
  }
}

function isAbsoluteForPlatform(root: string, platform: NodeJS.Platform): boolean {
  return pathApi(platform).isAbsolute(root) || isAbsolute(root);
}

function pathApi(platform: NodeJS.Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix;
}

function windowsRoot(input: DataPathInput): string {
  return input.env.LOCALAPPDATA ?? join(input.home, 'AppData', 'Local');
}

function macosRoot(input: DataPathInput): string {
  return join(input.home, 'Library', 'Application Support');
}

function unixRoot(input: DataPathInput): string {
  return input.env.XDG_DATA_HOME ?? join(input.home, '.local', 'share');
}
