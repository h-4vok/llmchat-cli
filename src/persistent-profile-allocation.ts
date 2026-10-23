import {
  acquireProfileLeaseLock,
  defaultProfileLeaseFileSystem,
  type ProfileLeaseFileSystem,
} from './profile-lease-lock.js';

export interface ProfileLease {
  profileDirectory: string;
  release(): void;
}

export interface ProfileAllocator {
  acquire(stableDirectory: string): ProfileLease;
}

type ProcessIsAlive = (pid: number) => boolean;

export function createPersistentProfileAllocator(
  fileSystem: ProfileLeaseFileSystem = defaultProfileLeaseFileSystem,
  processIsAlive: ProcessIsAlive = isProcessAlive,
): ProfileAllocator {
  return {
    acquire(stableDirectory) {
      let slot = 0;
      let acquired: ProfileLease | undefined;
      do {
        acquired = tryAcquire(stableDirectory, slot, fileSystem, processIsAlive);
        slot += 1;
      } while (!acquired);
      return acquired;
    },
  };
}

function tryAcquire(
  stableDirectory: string,
  slot: number,
  fileSystem: ProfileLeaseFileSystem,
  processIsAlive: ProcessIsAlive,
): ProfileLease | undefined {
  const profileDirectory = derivedProfileDirectory(stableDirectory, slot);
  fileSystem.mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  fileSystem.chmod(profileDirectory, 0o700);
  const lockDirectory = `${stableDirectory}.lease-${String(slot)}`;
  const release = acquireProfileLeaseLock(lockDirectory, fileSystem, processIsAlive);
  return release ? { profileDirectory, release } : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (failure) {
    return (failure as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function derivedProfileDirectory(stableDirectory: string, slot: number): string {
  return slot === 0 ? stableDirectory : `${stableDirectory}.concurrent-${String(slot)}`;
}
