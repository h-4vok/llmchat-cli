import type {
  GeminiActivity,
  GeminiFlowOptions,
  GeminiLocalDiagnostic,
  GeminiPromptPort,
  GeminiPromptRequest,
  GeminiPromptResponse,
  GeminiSignal,
} from './gemini-flow.js';

export class GeminiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiResponseError';
  }
}

export class GeminiInactivityError extends Error {
  constructor(public readonly diagnostic: GeminiLocalDiagnostic) {
    super(`Gemini became inactive (${diagnostic.state}): ${diagnostic.message}`);
    this.name = 'GeminiInactivityError';
  }
}

export function runGeminiExecution(
  port: GeminiPromptPort,
  request: GeminiPromptRequest,
  options: GeminiFlowOptions,
): Promise<GeminiPromptResponse> {
  return new Promise((resolve, reject) => {
    new GeminiExecution(port, options, resolve, reject).start(request);
  });
}

class GeminiExecution {
  private active = true;
  private timerVersion = 0;
  private cancelTimer = ignore;
  private readonly cancellation = new AbortController();
  private submission: Promise<void> = Promise.resolve();
  private removeAbortListener = ignore;

  constructor(
    private readonly port: GeminiPromptPort,
    private readonly options: GeminiFlowOptions,
    private readonly resolve: (response: GeminiPromptResponse) => void,
    private readonly reject: (reason?: unknown) => void,
  ) {}

  start(request: GeminiPromptRequest): void {
    this.armTimer();
    try {
      this.submission = Promise.resolve(
        this.port.submit(request, (signal) => this.receive(signal), this.cancellation.signal),
      );
      this.submission.catch((error: unknown) => this.fail(error));
      this.subscribeToCancellation();
    } catch (error) {
      this.fail(error);
    }
  }

  private subscribeToCancellation(): void {
    const signal = this.options.signal;
    if (!signal) return;
    const cancel = () => this.cancel(signal.reason);
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, { once: true });
    this.removeAbortListener = () => signal.removeEventListener('abort', cancel);
  }

  private receive(signal: GeminiSignal): void {
    if (!this.active) return;
    if (signal.kind === 'activity') return this.reportActivity(signal);
    if (signal.kind === 'error') return this.fail(new GeminiResponseError(signal.message));
    this.complete(toResponse(signal));
  }

  private reportActivity(activity: GeminiActivity): void {
    this.options.onActivity?.(activity);
    this.armTimer();
  }

  private armTimer(): void {
    this.cancelTimer();
    const version = ++this.timerVersion;
    const schedule = this.options.schedule ?? scheduleTimeout;
    this.cancelTimer = schedule(() => this.expire(version), this.options.inactivityMs);
  }

  private expire(version: number): void {
    if (!this.active || version !== this.timerVersion) return;
    this.finish();
    this.cancellation.abort(new DOMException('Gemini became inactive.', 'TimeoutError'));
    void this.submission.then(() => this.rejectInactive(), () => this.rejectInactive());
  }

  private async rejectInactive(): Promise<void> {
    try {
      this.reject(new GeminiInactivityError(await this.port.diagnoseLocally()));
    } catch (error) {
      this.reject(error);
    }
  }

  private cancel(reason: unknown): void {
    if (!this.active) return;
    this.finish();
    this.cancellation.abort(reason);
    void this.submission.then(() => this.reject(reason), () => this.reject(reason));
  }

  private complete(response: GeminiPromptResponse): void {
    this.finish();
    this.resolve(response);
  }

  private fail(error: unknown): void {
    if (!this.active) return;
    this.finish();
    this.reject(error);
  }

  private finish(): void {
    this.active = false;
    this.cancelTimer();
    this.removeAbortListener();
  }
}

function toResponse(signal: Extract<GeminiSignal, { kind: 'response' }>): GeminiPromptResponse {
  return signal.model === undefined
    ? { text: signal.text }
    : { text: signal.text, model: signal.model };
}

function scheduleTimeout(expire: () => void, inactivityMs: number): () => void {
  const timer = setTimeout(expire, inactivityMs);
  return () => clearTimeout(timer);
}

function ignore(): void {}
