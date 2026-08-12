import type { AdapterContext } from './adapter-contract.js';
import type { ProfileAllocator, ProfileLease } from './persistent-profile-allocation.js';

export interface ProfileLeaseRegistry {
  acquire(context: AdapterContext): ProfileLease;
  context(context: AdapterContext): AdapterContext;
  release(context: AdapterContext): void;
}

export function createProfileLeaseRegistry(allocator: ProfileAllocator): ProfileLeaseRegistry {
  const leases = new WeakMap<AdapterContext, ProfileLease>();
  return {
    acquire(context) {
      const current = leases.get(context);
      if (current) return current;
      const acquired = allocator.acquire(context.profileDirectory);
      leases.set(context, acquired);
      return acquired;
    },
    context(context) {
      const profileDirectory = leases.get(context)?.profileDirectory;
      return profileDirectory ? { ...context, profileDirectory } : context;
    },
    release(context) {
      leases.get(context)?.release();
      leases.delete(context);
    },
  };
}
