export const runtimeConfig = Object.freeze({
  exitCode: { success: 0, failure: 1 },
  intervals: { sessionPollMs: 750, sessionDetectionAttempts: 14 },
  timeouts: {
    chatMs: 180_000,
    geminiInactivityMs: 120_000,
    browserLaunchMs: 15_000,
    healthElementMs: 15_000,
  },
} as const);
