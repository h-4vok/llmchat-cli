import type {
  ProviderAdapter,
  AdapterContext,
  AdapterDiagnostic,
  TimeoutOptions,
} from './adapter-contract.js';
import { ensureBrowserSession, type BrowserSessionPorts } from './browser-session.js';
import { diagnosticForBrowserSession } from './browser-session-diagnostic.js';
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

export type RealRuntimeOptions = {
  provisionStorage?: StorageProvisioner;
  sessionPorts?: BrowserSessionPorts;
  adapter?: ProviderAdapter;
  profileAllocator?: ProfileAllocator;
  timeout?: TimeoutOptions;
};

export function createRealChatRuntime(options: RealRuntimeOptions = {}): ChatRuntime {
  const provision = resolveProvisioner(options);
  const sessions = resolveSessions(options);
  const adapter = resolveAdapter(options, sessions.notifications);
  const allocator = options.profileAllocator ?? createPersistentProfileAllocator();
  const profiles = createProfileLeaseRegistry(allocator);
  const diagnostics = new WeakMap<AdapterContext, AdapterDiagnostic>();
  return {
    adapterFor: () => withSessionDiagnostic(adapter, diagnostics, profiles),
    contextFor(provider) {
      return toContext(provision(provider));
    },
    ensureSession(provider, context) {
      const lease = profiles.acquire(context);
      return ensureBrowserSession(
        { provider, profileDirectory: lease.profileDirectory },
        sessions,
        (state) => {
          diagnostics.set(context, diagnosticForBrowserSession(state, provider));
        },
      );
    },
    releaseContext(context) {
      profiles.release(context);
      diagnostics.delete(context);
    },
    timeout: resolveTimeout(options),
  };
}

function withSessionDiagnostic(
  adapter: ProviderAdapter,
  diagnostics: WeakMap<AdapterContext, AdapterDiagnostic>,
  profiles: ProfileLeaseRegistry,
): ProviderAdapter {
  return {
    provider: adapter.provider,
    executeChat: (request, context) => adapter.executeChat(request, profiles.context(context)),
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
  const activity = new Set<() => void>();
  return {
    profileDirectory: paths.profileDirectory,
    diagnosticsDirectory: paths.diagnosticsDirectory,
    screenshotsDirectory: paths.screenshotsDirectory,
    configuration: {},
    notify() {
      activity.forEach((listener) => listener());
    },
    onActivity(listener) {
      activity.add(listener);
      return () => activity.delete(listener);
    },
  };
}
