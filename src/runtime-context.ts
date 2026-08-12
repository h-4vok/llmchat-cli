import type { AdapterContext } from './adapter-contract.js';
import type { ChatRuntime } from './chat-runtime.js';

export async function withRuntimeContext(
  runtime: ChatRuntime,
  provider: string,
  use: (context: AdapterContext) => Promise<void>,
): Promise<void> {
  const context = runtime.contextFor(provider);
  try {
    await use(context);
  } finally {
    await runtime.releaseContext?.(context);
  }
}
