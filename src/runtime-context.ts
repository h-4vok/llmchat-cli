import type { AdapterContext } from './adapter-contract.js';
import type { ChatRuntime } from './chat-runtime.js';

export async function withRuntimeContext<Result>(
  runtime: ChatRuntime,
  provider: string,
  use: (context: AdapterContext) => Promise<Result>,
): Promise<Result> {
  const context = runtime.contextFor(provider);
  try {
    return await use(context);
  } finally {
    await runtime.releaseContext?.(context);
  }
}
