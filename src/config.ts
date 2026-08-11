import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configPath } from './config-path.js';

export type Config = { schemaVersion: 1; defaultProvider?: string; [key: string]: unknown };

export function readConfig(path: string): Partial<Config> {
  try {
    return parseConfig(readFileSync(path).toString());
  } catch (error) {
    return handleReadError(error);
  }
}

export function readCurrentConfig(): Partial<Config> {
  return readConfig(configPath());
}

export function saveDefaultProvider(provider: string): void {
  const config = readCurrentConfig();
  writeConfig({ ...config, schemaVersion: 1, defaultProvider: provider });
}

export function removeDefaultProvider(): void {
  const config = readCurrentConfig();
  if (!Object.hasOwn(config, 'defaultProvider')) return;
  delete config.defaultProvider;
  writeConfig({ ...config, schemaVersion: 1 });
}

function parseConfig(rawConfig: string): Partial<Config> {
  const parsed: unknown = JSON.parse(rawConfig);
  if (isConfig(parsed)) return parsed;
  throw new Error('Configuration must be an object.');
}

function isConfig(value: unknown): value is Partial<Config> {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}

function handleReadError(error: unknown): Partial<Config> {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
  throw new Error('Unable to read llmchat configuration.', { cause: error });
}

function writeConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
