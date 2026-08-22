import type {
  ProviderAdapter,
  AdapterContext,
  AdapterDiagnostic,
  TimeoutOptions,
} from './adapter-contract.js';
import type { BrowserSessionPorts } from './browser-session.js';
import { adapterForProvider, capabilitiesForProvider } from './chat-runtime.js';
import type { ChatRuntime, StorageProvisioner } from './chat-runtime.js';
import { createGeminiAdapter } from './gemini-adapter.js';
import { createPlaywrightGeminiBrowser } from './gemini-playwright-browser.js';
import { createPlaywrightBrowserLauncher } from './playwright-browser-launcher.js';
import { createPersistentBrowserSessionPort } from './persistent-browser-session.js';
import { ensureProviderStorage } from './secure-storage.js';
import { createSystemNotificationPort } from './system-native-notification.js';
import type { NativeNotificationPort } from './native-notification.js';
import {
  createPersistentProfileAllocator,
  type ProfileAllocator,
} from './persistent-profile-allocation.js';
import { createProfileLeaseRegistry, type ProfileLeaseRegistry } from './profile-lease-registry.js';
import { runtimeConfig } from './config/runtime.js';
import type { StorageOptions } from './secure-storage.js';
import { persistTranscriptDiagnostic } from './chat-diagnostics.js';
import { createDemoAdapter } from './demo-adapter.js';
import { ensureRealChatSession } from './real-chat-session.js';

export type RealRuntimeOptions = {
  provisionStorage?: StorageProvisioner;
  sessionPorts?: BrowserSessionPorts;
  adapter?: ProviderAdapter;
  profileAllocator?: ProfileAllocator;
  timeout?: TimeoutOptions;
  recordChat?: ChatRuntime['recordChat'];
  diagnosticStorage?: StorageOptions;
};
export function createRealChatRuntime(options: RealRuntimeOptions = {}): ChatRuntime {
  const provision = resolveProvisioner(options);
  const sessions = resolveSessions(options);
  const adapter = resolveAdapter(options, sessions.notifications);
  const demoAdapter = createDemoAdapter();
  const allocator = options.profileAllocator ?? createPersistentProfileAllocator();
  const profiles = createProfileLeaseRegistry(allocator);
  const diagnostics = new WeakMap<AdapterContext, AdapterDiagnostic>();
  const recordChat = resolveDiagnosticRecorder(options);
  const geminiAdapter = withSessionDiagnostic(adapter, diagnostics, profiles);
  return {
    adapterFor: (provider) => adapterForProvider(provider, geminiAdapter, demoAdapter),
    capabilitiesFor: capabilitiesForProvider,
    contextFor(provider) {
      return toContext(provision(provider));
    },
    ensureSession(provider, context, options = {}) {
      return ensureRealChatSession({
        provider,
        context,
        options,
        ports: sessions,
        profiles,
        diagnostics,
      });
    },
    releaseContext(context) {
      profiles.release(context);
      diagnostics.delete(context);
    },
    ...(recordChat ? { recordChat } : {}),
    timeout: resolveTimeout(options),
  };
}
function resolveDiagnosticRecorder(options: RealRuntimeOptions): ChatRuntime['recordChat'] {
  if (options.recordChat) return options.recordChat;
  if (options.provisionStorage && !options.diagnosticStorage) return undefined;
  return (provider, transcript) =>
    persistTranscriptDiagnostic(provider, transcript, options.diagnosticStorage);
}
function withSessionDiagnostic(
  adapter: ProviderAdapter,
  diagnostics: WeakMap<AdapterContext, AdapterDiagnostic>,
  profiles: ProfileLeaseRegistry,
): ProviderAdapter {
  return {
    provider: adapter.provider,
    executeChat: (request, context, signal) =>
      adapter.executeChat(request, profiles.context(context), signal),
    async diagnose(context) {
      const diagnostic = diagnostics.get(context);
      if (isSessionBlocking(diagnostic)) return diagnostic;
      return adapter.diagnose(profiles.context(context));
    },
    checkHealth: (context) => adapter.checkHealth(profiles.context(context)),
  };
}
function isSessionBlocking(
  diagnostic: AdapterDiagnostic | undefined,
): diagnostic is AdapterDiagnostic {
  return diagnostic?.state === 'blocked' || diagnostic?.state === 'session-required';
}
function resolveProvisioner(options: RealRuntimeOptions): StorageProvisioner {
  return options.provisionStorage ?? ensureProviderStorage;
}
function resolveSessions(options: RealRuntimeOptions): BrowserSessionPorts {
  return options.sessionPorts ?? defaultSessionPorts();
}
function resolveAdapter(
  options: RealRuntimeOptions,
  notifications: NativeNotificationPort,
): ProviderAdapter {
  return (
    options.adapter ??
    createGeminiAdapter({
      browser: createPlaywrightGeminiBrowser(notifications),
      inactivityMs: runtimeConfig.timeouts.geminiInactivityMs,
    })
  );
}
function resolveTimeout(options: RealRuntimeOptions): TimeoutOptions {
  return options.timeout ?? { timeoutMs: runtimeConfig.timeouts.chatMs };
}

function defaultSessionPorts(): BrowserSessionPorts {
  const launcher = createPlaywrightBrowserLauncher();
  return {
    browser: createPersistentBrowserSessionPort(launcher),
    notifications: createLazyNotificationPort(),
  };
}

export function createLazyNotificationPort(
  factory: () => NativeNotificationPort = createSystemNotificationPort,
): NativeNotificationPort {
  return { send: (notification) => factory().send(notification) };
}

function toContext(paths: ReturnType<StorageProvisioner>): AdapterContext {
  const activity = new Set<
    (notification: { kind: 'progress' | 'warning'; message: string }) => void
  >();
  return {
    profileDirectory: paths.profileDirectory,
    diagnosticsDirectory: paths.diagnosticsDirectory,
    screenshotsDirectory: paths.screenshotsDirectory,
    configuration: {},
    notify(notification) {
      activity.forEach((listener) => listener(notification));
    },
    onActivity(listener) {
      activity.add(listener);
      return () => activity.delete(listener);
    },
  };
}
