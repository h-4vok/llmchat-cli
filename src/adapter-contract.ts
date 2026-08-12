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
  screenshotsDirectory: string;
  configuration: Readonly<Record<string, unknown>>;
  notify(notification: AdapterNotification): void;
  onActivity?(listener: () => void): () => void;
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
  const schedule = timeoutScheduler(options);
  const inactivity = createInactivityTimer(schedule, options.timeoutMs);
  const unsubscribe = subscribeToActivity(context, inactivity.reset);
  const operation = Promise.resolve()
    .then(() => adapter.executeChat(request, context))
    .then((response): ResponseOutcome<Response> => ({ kind: 'response', response }));
  let outcome: ResponseOutcome<Response> | TimeoutOutcome;
  try {
    outcome = await Promise.race([operation, inactivity.outcome]);
  } finally {
    inactivity.cancel();
    unsubscribe();
  }
  if (outcome.kind === 'response') return outcome.response;
  throw new AdapterTimeoutError(await adapter.diagnose(context));
}

function timeoutScheduler(options: TimeoutOptions): TimeoutScheduler {
  return options.schedule ?? scheduleTimeout;
}

function subscribeToActivity(context: AdapterContext, reset: () => void): () => void {
  return context.onActivity ? context.onActivity(reset) : ignore;
}

function createInactivityTimer(schedule: TimeoutScheduler, timeoutMs: number) {
  let cancelTimer = ignore;
  let version = 0;
  let resolveTimeout!: (outcome: TimeoutOutcome) => void;
  const outcome = new Promise<TimeoutOutcome>((resolve) => {
    resolveTimeout = resolve;
  });
  const reset = () => {
    cancelTimer();
    const expectedVersion = ++version;
    cancelTimer = schedule(() => expire(expectedVersion), timeoutMs);
  };
  const expire = (expectedVersion: number) => {
    if (expectedVersion === version) resolveTimeout(timeoutOutcome);
  };
  reset();
  return {
    outcome,
    reset,
    cancel() {
      version += 1;
      cancelTimer();
    },
  };
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

function ignore(): void {}
