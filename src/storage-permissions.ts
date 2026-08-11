import type { StorageFileSystem } from './storage-file-system.js';
import type { StorageAccessControl } from './windows-access-control.js';

const directoryMode = 0o700;
const fileMode = 0o600;

export function secureDirectory(
  storage: StorageFileSystem,
  access: StorageAccessControl,
  path: string,
  platform: NodeJS.Platform,
): void {
  if (platform === 'win32') return verifyWindowsAccess(access.secureDirectory(path), path);
  storage.chmod(path, directoryMode);
}

export function secureFile(
  storage: StorageFileSystem,
  access: StorageAccessControl,
  path: string,
  platform: NodeJS.Platform,
): void {
  if (platform === 'win32') return verifyWindowsAccess(access.secureFile(path), path);
  storage.chmod(path, fileMode);
}

function verifyWindowsAccess(verified: boolean, path: string): void {
  if (!verified) throw new Error(`Unable to verify user-only access for "${path}".`);
}
