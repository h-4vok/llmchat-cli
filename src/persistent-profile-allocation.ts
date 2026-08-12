import { chmodSync, mkdirSync, rmdirSync } from 'node:fs';

export interface ProfileLease {
  profileDirectory: string;
  release(): void;
}

export interface ProfileAllocator {
  acquire(stableDirectory: string): ProfileLease;
}

type ProfileFileSystem = {
  mkdir: typeof mkdirSync;
  chmod: typeof chmodSync;
  rmdir: typeof rmdirSync;
};

const nodeProfileFileSystem: ProfileFileSystem = {
  mkdir: mkdirSync,
  chmod: chmodSync,
  rmdir: rmdirSync,
};

export function createPersistentProfileAllocator(
  fileSystem: ProfileFileSystem = nodeProfileFileSystem,
): ProfileAllocator {
  return {
    acquire(stableDirectory) {
      let slot = 0;
      let acquired: ProfileLease | undefined;
      do {
        acquired = tryAcquire(stableDirectory, slot, fileSystem);
        slot += 1;
      } while (!acquired);
      return acquired;
    },
  };
}

function tryAcquire(
  stableDirectory: string,
  slot: number,
  fileSystem: ProfileFileSystem,
): ProfileLease | undefined {
  const profileDirectory = derivedProfileDirectory(stableDirectory, slot);
  fileSystem.mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  fileSystem.chmod(profileDirectory, 0o700);
  const lockDirectory = `${stableDirectory}.lease-${String(slot)}`;
  try {
    fileSystem.mkdir(lockDirectory, { mode: 0o700 });
  } catch (failure) {
    if (isOccupied(failure)) return undefined;
    throw failure;
  }
  return lease(profileDirectory, lockDirectory, fileSystem);
}

function lease(
  profileDirectory: string,
  lockDirectory: string,
  fileSystem: ProfileFileSystem,
): ProfileLease {
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    fileSystem.rmdir(lockDirectory);
    process.off('exit', release);
  };
  process.once('exit', release);
  return {
    profileDirectory,
    release,
  };
}

function derivedProfileDirectory(stableDirectory: string, slot: number): string {
  return slot === 0 ? stableDirectory : `${stableDirectory}.concurrent-${String(slot)}`;
}

function isOccupied(failure: unknown): boolean {
  return (failure as NodeJS.ErrnoException).code === 'EEXIST';
}
