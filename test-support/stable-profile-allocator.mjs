export const stableProfileAllocator = {
  acquire(profileDirectory) {
    return { profileDirectory, release() {} };
  },
};
