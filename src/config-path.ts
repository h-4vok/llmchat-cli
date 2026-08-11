import { homedir, platform as runtimePlatform } from 'node:os';
import { join } from 'node:path';

export type ConfigPathInput = {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
};

type RootResolver = (input: ConfigPathInput) => string;

const platformRoots: Partial<Record<NodeJS.Platform, RootResolver>> = {
  darwin: macosRoot,
  win32: windowsRoot,
};

export function configPath(input = runtimeInput()): string {
  return join(configRoot(input), 'llmchat', 'config.json');
}

function runtimeInput(): ConfigPathInput {
  return { env: process.env, home: homedir(), platform: runtimePlatform() };
}

function configRoot(input: ConfigPathInput): string {
  return (platformRoots[input.platform] ?? unixRoot)(input);
}

function windowsRoot(input: ConfigPathInput): string {
  return input.env.LOCALAPPDATA ?? join(input.home, 'AppData', 'Local');
}

function macosRoot(input: ConfigPathInput): string {
  return join(input.home, 'Library', 'Application Support');
}

function unixRoot(input: ConfigPathInput): string {
  return input.env.XDG_CONFIG_HOME ?? join(input.home, '.config');
}
