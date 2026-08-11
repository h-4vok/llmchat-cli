import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { nodeBackupExclusion, type BackupExclusion } from './backup-exclusion.js';
import {
  providerStoragePaths,
  runtimeDataPathInput,
  type DataPathInput,
  type ProviderStoragePaths,
} from './data-path.js';
import { redactSessionSecrets } from './secret-redaction.js';
import { secureDirectory, secureFile } from './storage-permissions.js';
import { nodeFileSystem, type StorageFileSystem } from './storage-file-system.js';
import { nodeWindowsAccessControl, type StorageAccessControl } from './windows-access-control.js';

const directoryMode = 0o700;
const fileMode = 0o600;

export type { StorageFileSystem } from './storage-file-system.js';

export type StorageOptions = {
  input?: DataPathInput;
  now?: () => Date;
  artifactId?: () => string;
  fileSystem?: StorageFileSystem;
  backupExclusion?: BackupExclusion;
  accessControl?: StorageAccessControl;
};

export type DiagnosticLogEntry = {
  message: string;
  prompt?: string;
  response?: string;
};

export function ensureProviderStorage(
  provider: string,
  options: StorageOptions = {},
): ProviderStoragePaths {
  const { input, fileSystem } = storageRuntime(options);
  const access = accessControl(options);
  const paths = providerStoragePaths(provider, input);
  for (const directory of storageDirectories(paths)) {
    fileSystem.mkdir(directory, { recursive: true, mode: directoryMode });
    secureDirectory(fileSystem, access, directory, input.platform);
  }
  verifyBackupExclusion(options, paths.root, input.platform);
  return paths;
}

export function appendDiagnosticLog(
  provider: string,
  entry: DiagnosticLogEntry,
  options: StorageOptions = {},
): string {
  const paths = ensureProviderStorage(provider, options);
  const path = join(paths.logsDirectory, 'diagnostic.log');
  const record = diagnosticRecord(entry, clock(options)());
  const storage = fileSystem(options);
  const access = accessControl(options);
  const platform = storageInput(options).platform;
  storage.appendFileSafely(path, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: fileMode,
    beforeWrite: () => secureFile(storage, access, path, platform),
    afterWrite: () => secureFile(storage, access, path, platform),
  });
  return path;
}

export function saveDiagnostic(
  provider: string,
  content: string,
  options: StorageOptions = {},
): string {
  return saveArtifact(
    provider,
    redactSessionSecrets(content),
    'txt',
    'diagnosticsDirectory',
    options,
  );
}

export function saveScreenshot(
  provider: string,
  content: Uint8Array,
  options: StorageOptions = {},
): string {
  return saveArtifact(provider, content, 'png', 'screenshotsDirectory', options);
}

function saveArtifact(
  provider: string,
  content: string | Uint8Array,
  extension: string,
  directory: 'diagnosticsDirectory' | 'screenshotsDirectory',
  options: StorageOptions,
): string {
  const paths = ensureProviderStorage(provider, options);
  const name = `${artifactTimestamp(clock(options)())}-${artifactId(options)()}.${extension}`;
  const path = join(paths[directory], name);
  fileSystem(options).writeFile(path, content, { flag: 'wx', mode: fileMode });
  secureFile(fileSystem(options), accessControl(options), path, storageInput(options).platform);
  return path;
}

function diagnosticRecord(entry: DiagnosticLogEntry, now: Date): Record<string, string> {
  return {
    timestamp: now.toISOString(),
    message: redactSessionSecrets(entry.message),
    prompt: redactSessionSecrets(entry.prompt ?? ''),
    response: redactSessionSecrets(entry.response ?? ''),
  };
}

function storageDirectories(paths: ProviderStoragePaths): string[] {
  return [
    paths.root,
    paths.profileDirectory,
    paths.logsDirectory,
    paths.diagnosticsDirectory,
    paths.screenshotsDirectory,
  ];
}

function verifyBackupExclusion(
  options: StorageOptions,
  root: string,
  platform: NodeJS.Platform,
): void {
  const exclusion = options.backupExclusion ?? nodeBackupExclusion;
  if (!exclusion.excludeAndVerify(root, platform)) {
    throw new Error(`Unable to verify backup exclusion for "${root}".`);
  }
}

function fileSystem(options: StorageOptions): StorageFileSystem {
  return options.fileSystem ?? nodeFileSystem;
}

function accessControl(options: StorageOptions): StorageAccessControl {
  return options.accessControl ?? nodeWindowsAccessControl;
}

function storageInput(options: StorageOptions): DataPathInput {
  return options.input ?? runtimeDataPathInput();
}

function storageRuntime(options: StorageOptions): {
  input: DataPathInput;
  fileSystem: StorageFileSystem;
} {
  return {
    input: storageInput(options),
    fileSystem: fileSystem(options),
  };
}

function clock(options: StorageOptions): () => Date {
  return options.now ?? (() => new Date());
}

function artifactId(options: StorageOptions): () => string {
  return options.artifactId ?? randomUUID;
}

function artifactTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
