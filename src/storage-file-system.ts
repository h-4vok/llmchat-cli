import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';

type WriteOptions = { encoding?: BufferEncoding; flag: string; mode: number };
type SecureAppendOptions = {
  encoding: BufferEncoding;
  mode: number;
  beforeWrite(): void;
  afterWrite(): void;
};

export type StorageFileSystem = {
  mkdir(path: string, options: { recursive: true; mode: number }): void;
  chmod(path: string, mode: number): void;
  appendFileSafely(path: string, content: string, options: SecureAppendOptions): void;
  writeFile(path: string, content: string | Uint8Array, options: WriteOptions): void;
};

type FileOperations = {
  mkdir: typeof mkdirSync;
  chmod: typeof chmodSync;
  close: typeof closeSync;
  exists: typeof existsSync;
  fchmod: typeof fchmodSync;
  lstat: typeof lstatSync;
  open: typeof openSync;
  writeFile: typeof writeFileSync;
};

const nodeOperations: FileOperations = {
  mkdir: mkdirSync,
  chmod: chmodSync,
  close: closeSync,
  exists: existsSync,
  fchmod: fchmodSync,
  lstat: lstatSync,
  open: openSync,
  writeFile: writeFileSync,
};

export function createStorageFileSystem(
  overrides: Partial<FileOperations> = {},
): StorageFileSystem {
  const operations = { ...nodeOperations, ...overrides };
  return {
    mkdir: (path, options) => operations.mkdir(path, options),
    chmod: (path, mode) => operations.chmod(path, mode),
    appendFileSafely: (path, content, options) => secureAppend(operations, path, content, options),
    writeFile: (path, content, options) => operations.writeFile(path, content, options),
  };
}

export const nodeFileSystem = createStorageFileSystem();

function secureAppend(
  operations: FileOperations,
  path: string,
  content: string,
  options: SecureAppendOptions,
): void {
  rejectSymbolicLink(operations, path);
  const descriptor = operations.open(
    path,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    options.mode,
  );
  try {
    operations.fchmod(descriptor, options.mode);
    options.beforeWrite();
    operations.writeFile(descriptor, content, { encoding: options.encoding });
    operations.fchmod(descriptor, options.mode);
    options.afterWrite();
  } finally {
    operations.close(descriptor);
  }
}

function rejectSymbolicLink(operations: FileOperations, path: string): void {
  if (operations.exists(path) && operations.lstat(path).isSymbolicLink()) {
    throw new Error(`Refusing to append through symbolic link "${path}".`);
  }
}
