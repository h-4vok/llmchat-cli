import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

export type ProfileLeaseFileSystem = {
  mkdir: typeof mkdirSync;
  chmod: typeof chmodSync;
  readFile: typeof readFileSync;
  rmdir: typeof rmdirSync;
  unlink: typeof unlinkSync;
  rename: typeof renameSync;
  writeFile: typeof writeFileSync;
};

export const defaultProfileLeaseFileSystem: ProfileLeaseFileSystem = {
  mkdir: mkdirSync,
  chmod: chmodSync,
  readFile: readFileSync,
  rmdir: rmdirSync,
  unlink: unlinkSync,
  rename: renameSync,
  writeFile: writeFileSync,
};

type ProcessIsAlive = (pid: number) => boolean;
const ownerReadAttempts = 3;
const ownerReadDelayMs = 10;

export function acquireProfileLeaseLock(
  lockDirectory: string,
  fileSystem: ProfileLeaseFileSystem = defaultProfileLeaseFileSystem,
  processIsAlive: ProcessIsAlive,
): (() => void) | undefined {
  if (!acquireLock(lockDirectory, fileSystem, processIsAlive)) return undefined;
  writeLeaseOwner(lockDirectory, fileSystem);
  return registerLease(lockDirectory, fileSystem);
}

function acquireLock(
  lockDirectory: string,
  fileSystem: ProfileLeaseFileSystem,
  processIsAlive: ProcessIsAlive,
): boolean {
  if (tryCreateLock(lockDirectory, fileSystem)) return true;
  if (!reclaimAbandonedLease(lockDirectory, fileSystem, processIsAlive)) return false;
  return tryCreateLock(lockDirectory, fileSystem);
}

function tryCreateLock(lockDirectory: string, fileSystem: ProfileLeaseFileSystem): boolean {
  try {
    fileSystem.mkdir(lockDirectory, { mode: 0o700 });
    return true;
  } catch (failure) {
    if (isOccupied(failure)) return false;
    throw failure;
  }
}

function writeLeaseOwner(lockDirectory: string, fileSystem: ProfileLeaseFileSystem): void {
  try {
    fileSystem.writeFile(`${lockDirectory}/owner`, String(process.pid), { mode: 0o600 });
  } catch (failure) {
    fileSystem.rmdir(lockDirectory);
    throw failure;
  }
}

function reclaimAbandonedLease(
  lockDirectory: string,
  fileSystem: ProfileLeaseFileSystem,
  processIsAlive: ProcessIsAlive,
): boolean {
  const ownerPid = readOwnerPid(lockDirectory, fileSystem);
  if (!ownerPid)
    throw new Error(
      `Browser profile lease has no owner metadata at "${lockDirectory}"; remove it only after confirming no LLMChat process is using the profile.`,
    );
  if (processIsAlive(ownerPid)) return false;
  return removeClaimedLease(lockDirectory, fileSystem);
}

function removeClaimedLease(lockDirectory: string, fileSystem: ProfileLeaseFileSystem): boolean {
  const recoveryDirectory = `${lockDirectory}.reclaim-${String(process.pid)}-${randomUUID()}`;
  try {
    fileSystem.rename(lockDirectory, recoveryDirectory);
  } catch (failure) {
    if (isLeaseRaceLost(failure)) return false;
    throw failure;
  }
  fileSystem.unlink(`${recoveryDirectory}/owner`);
  fileSystem.rmdir(recoveryDirectory);
  return true;
}

function readOwnerPid(
  lockDirectory: string,
  fileSystem: ProfileLeaseFileSystem,
): number | undefined {
  for (let attempt = 0; attempt < ownerReadAttempts; attempt += 1) {
    const pid = tryReadOwnerPid(lockDirectory, fileSystem);
    if (pid) return pid;
    if (attempt < ownerReadAttempts - 1) waitForOwnerMetadata();
  }
  return undefined;
}

function tryReadOwnerPid(
  lockDirectory: string,
  fileSystem: ProfileLeaseFileSystem,
): number | undefined {
  try {
    const pid = Number(fileSystem.readFile(`${lockDirectory}/owner`, 'utf8'));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function waitForOwnerMetadata(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ownerReadDelayMs);
}

function registerLease(lockDirectory: string, fileSystem: ProfileLeaseFileSystem): () => void {
  let active = true;
  const release = () => {
    if (!active) return;
    fileSystem.unlink(`${lockDirectory}/owner`);
    fileSystem.rmdir(lockDirectory);
    active = false;
    process.off('exit', release);
  };
  process.once('exit', release);
  return release;
}

function isOccupied(failure: unknown): boolean {
  return (failure as NodeJS.ErrnoException).code === 'EEXIST';
}

function isLeaseRaceLost(failure: unknown): boolean {
  const code = (failure as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EEXIST';
}
