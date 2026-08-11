export type DiagnosticState = 'progress' | 'error' | 'blocked' | 'session-required';
export type HealthStatus = 'healthy' | 'degraded' | 'broken';

export type AdapterDiagnostic = {
  state: DiagnosticState;
  message: string;
};

export type AdapterHealth = {
  status: HealthStatus;
  message: string;
};

export type AdapterNotification = {
  kind: 'progress' | 'warning';
  message: string;
};

export type AdapterContext = {
  profileDirectory: string;
  diagnosticsDirectory: string;
  configuration: Readonly<Record<string, unknown>>;
  notify(notification: AdapterNotification): void;
};

export type ChatRequest = {
  prompt: string;
  model?: string;
  systemInstructions?: string;
};

export type ChatResponse = {
  text: string;
};

export interface ProviderAdapter<
  Request extends ChatRequest = ChatRequest,
  Response extends ChatResponse = ChatResponse,
> {
  readonly provider: string;
  executeChat(request: Request, context: AdapterContext): Promise<Response>;
  diagnose(context: AdapterContext): Promise<AdapterDiagnostic>;
  checkHealth(context: AdapterContext): Promise<AdapterHealth>;
}

export type TimeoutScheduler = (expire: () => void, timeoutMs: number) => () => void;

export type TimeoutOptions = {
  timeoutMs: number;
  schedule?: TimeoutScheduler;
};

type ResponseOutcome<Response> = { kind: 'response'; response: Response };
type TimeoutOutcome = { kind: 'timeout' };

const timeoutOutcome: TimeoutOutcome = { kind: 'timeout' };

export class AdapterTimeoutError extends Error {
  constructor(public readonly diagnostic: AdapterDiagnostic) {
    super(`Adapter timed out (${diagnostic.state}): ${diagnostic.message}`);
    this.name = 'AdapterTimeoutError';
  }
}

export async function executeWithTimeout<
  Request extends ChatRequest,
  Response extends ChatResponse,
>(
  adapter: ProviderAdapter<Request, Response>,
  request: Request,
  context: AdapterContext,
  options: TimeoutOptions,
): Promise<Response> {
  const schedule = options.schedule ?? scheduleTimeout;
  let cancel!: () => void;
  const timeout = new Promise<TimeoutOutcome>((resolve) => {
    cancel = schedule(() => resolve(timeoutOutcome), options.timeoutMs);
  });
  const operation = Promise.resolve()
    .then(() => adapter.executeChat(request, context))
    .then((response): ResponseOutcome<Response> => ({ kind: 'response', response }));
  let outcome: ResponseOutcome<Response> | TimeoutOutcome;
  try {
    outcome = await Promise.race([operation, timeout]);
  } finally {
    cancel();
  }
  if (outcome.kind === 'response') return outcome.response;
  throw new AdapterTimeoutError(await adapter.diagnose(context));
}

export function runHealthCheck(
  adapter: ProviderAdapter,
  context: AdapterContext,
): Promise<AdapterHealth> {
  return adapter.checkHealth(context);
}

function scheduleTimeout(expire: () => void, timeoutMs: number): () => void {
  const timer = setTimeout(expire, timeoutMs);
  return () => clearTimeout(timer);
}
