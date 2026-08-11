export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `[error] ${error.message}`;
  return `[error] ${String(error)}`;
}
