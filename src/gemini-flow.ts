export type GeminiPromptRequest = {
  prompt: string;
  model?: string;
};

export type GeminiPromptResponse = {
  text: string;
  model?: string;
};

export type GeminiActivity = {
  kind: 'activity';
  message: string;
};

export type GeminiSignal =
  | GeminiActivity
  | { kind: 'response'; text: string; model?: string }
  | { kind: 'error'; message: string };

export type GeminiLocalDiagnostic = {
  state: string;
  message: string;
};

export interface GeminiPromptPort {
  submit(request: GeminiPromptRequest, emit: (signal: GeminiSignal) => void): void | Promise<void>;
  diagnoseLocally(): Promise<GeminiLocalDiagnostic>;
}

export type GeminiTimeoutScheduler = (expire: () => void, inactivityMs: number) => () => void;

export type GeminiFlowOptions = {
  inactivityMs: number;
  schedule?: GeminiTimeoutScheduler;
  onActivity?: (activity: GeminiActivity) => void;
};

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

export function executeGeminiPrompt(
  port: GeminiPromptPort,
  request: GeminiPromptRequest,
  options: GeminiFlowOptions,
): Promise<GeminiPromptResponse> {
  return new Promise((resolve, reject) => {
    const execution = new GeminiExecution(port, options, resolve, reject);
    execution.start(request);
  });
}

class GeminiExecution {
  private active = true;
  private timerVersion = 0;
  private cancelTimer = ignore;

  constructor(
    private readonly port: GeminiPromptPort,
    private readonly options: GeminiFlowOptions,
    private readonly resolve: (response: GeminiPromptResponse) => void,
    private readonly reject: (reason?: unknown) => void,
  ) {}

  start(request: GeminiPromptRequest): void {
    this.armTimer();
    try {
      Promise.resolve(this.port.submit(request, (signal) => this.receive(signal))).catch(
        (error: unknown) => this.fail(error),
      );
    } catch (error) {
      this.fail(error);
    }
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
    this.active = false;
    this.cancelTimer();
    void this.port
      .diagnoseLocally()
      .then((diagnostic) => this.reject(new GeminiInactivityError(diagnostic)), this.reject);
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
