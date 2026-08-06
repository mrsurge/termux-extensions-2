import { createExplorerRpcConnection } from './connection.ts';
import { installExplorerRpcClient } from './client.ts';
import {
  dispatchExplorerNotification,
  handleExplorerReconnect,
} from '../app/public-api.ts';
import {
  EXPLORER_RPC_NOTIFICATIONS,
  type ExplorerRpcMethod,
  type ExplorerRpcNotificationMethod,
} from './contract.ts';
import type { IoFactory, JsonObject } from '../../rpc/transport.ts';
import {
  diagnosticsPayloadStats,
  measureDiagnosticsLatency,
} from '../../diagnostics/latency-probe.ts';

type ExplorerRpcConnection = ReturnType<typeof createExplorerRpcConnection>;

interface ExplorerRpcRuntimeGlobals {
  __debugExplorer?: unknown;
  __cm6HandleUiPrefs?: (payload: JsonObject) => void;
  __cm6HandleWatcherConfig?: (payload: JsonObject) => void;
  __cm6HandleWatcherError?: (payload: JsonObject) => void;
  __cm6HandleWatcherModeStatus?: (payload: JsonObject) => void;
  __cm6HandleWatcherRaiseResult?: (payload: JsonObject) => void;
  __cm6PendingUiPrefs?: JsonObject | null;
}

export interface ExplorerRpcRuntimeDeps {
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  homeDir: string;
  toAbsolute: (path: string, base?: string | null, homeDir?: string) => string;
  getActiveProjectPath: () => string | null;
  getSessionActiveProject: () => string | null;
  applyHostActivePath: (path: string) => void;
  updateProblemsPanel: (payload: JsonObject) => void;
  reloadEditorFrame: () => void | Promise<void>;
  requestAdapterRestart: () => void | Promise<void>;
  buildSidebarMentionPayload: (payload: JsonObject) => JsonObject;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface ExplorerRpcRuntime {
  connect: () => Promise<ExplorerRpcConnection>;
  reconnect: () => void;
  isConnected: () => boolean;
  notify: (method: ExplorerRpcMethod, params?: JsonObject) => void;
  request: <TResult extends JsonObject = JsonObject>(
    method: ExplorerRpcMethod,
    params?: JsonObject,
    timeoutMs?: number,
  ) => Promise<TResult>;
}

function hostWindow(): Window & ExplorerRpcRuntimeGlobals {
  return window as Window & ExplorerRpcRuntimeGlobals;
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function stringField(payload: JsonObject, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

function deferCall(callback: () => void | Promise<void>): void {
  window.setTimeout(() => {
    try {
      void callback();
    } catch {}
  }, 0);
}

export function createExplorerRpcRuntime(deps: ExplorerRpcRuntimeDeps): ExplorerRpcRuntime {
  let explorerRpcConnection: ExplorerRpcConnection | null = null;
  let explorerNeedsResync = false;
  let visibilityHandlerInstalled = false;
  const log = deps.log || console.log.bind(console);
  const warn = deps.warn || console.warn.bind(console);
  const error = deps.error || console.error.bind(console);

  function handleExplorerRpcNotification(
    method: ExplorerRpcNotificationMethod,
    params: JsonObject,
  ): void {
    const payload = asJsonObject(params);
    const win = hostWindow();

    if (win.__debugExplorer) {
      log('[ExplorerRPC:event]', { method, payload });
    }

    if (
      method === EXPLORER_RPC_NOTIFICATIONS.watcherConfigUpdated
      && typeof win.__cm6HandleWatcherConfig === 'function'
    ) {
      win.__cm6HandleWatcherConfig(payload);
    }
    if (
      method === EXPLORER_RPC_NOTIFICATIONS.watcherModeStatus
      && typeof win.__cm6HandleWatcherModeStatus === 'function'
    ) {
      win.__cm6HandleWatcherModeStatus(payload);
    }
    if (
      method === EXPLORER_RPC_NOTIFICATIONS.watcherError
      && typeof win.__cm6HandleWatcherError === 'function'
    ) {
      win.__cm6HandleWatcherError(payload);
    }
    if (
      method === EXPLORER_RPC_NOTIFICATIONS.watcherLimitRaiseResult
      && typeof win.__cm6HandleWatcherRaiseResult === 'function'
    ) {
      win.__cm6HandleWatcherRaiseResult(payload);
    }
    if (method === EXPLORER_RPC_NOTIFICATIONS.prefsUiUpdated) {
      if (typeof win.__cm6HandleUiPrefs === 'function') {
        win.__cm6HandleUiPrefs(payload);
      } else {
        try { win.__cm6PendingUiPrefs = payload; } catch {}
      }
    }
    if (method === EXPLORER_RPC_NOTIFICATIONS.extensionsAdapterRestarting) {
      log('[adapter_restart] received', payload);
      deferCall(() => deps.reloadEditorFrame());
    }
    if (method === EXPLORER_RPC_NOTIFICATIONS.extensionsSettingsChanged) {
      log('[adapter_restart] settings changed', payload);
      deferCall(() => deps.requestAdapterRestart());
    }
    if (method === EXPLORER_RPC_NOTIFICATIONS.activeFileUpdated) {
      const rel = stringField(payload, 'rel');
      let abs = stringField(payload, 'abs');
      if (!abs && rel) {
        const projectRoot = deps.getActiveProjectPath() || deps.getSessionActiveProject();
        abs = projectRoot ? deps.toAbsolute(rel, projectRoot, deps.homeDir) : '';
      }
      if (abs) {
        try { deps.applyHostActivePath(abs); } catch {}
      }
    }
    if (method === EXPLORER_RPC_NOTIFICATIONS.diagnosticsDetail) {
      try {
        const keys = Object.keys(payload);
        const firstMarkers = keys.length > 0 ? payload[keys[0]] : [];
        const sampleMarkers = Array.isArray(firstMarkers) ? firstMarkers.slice(0, 1) : [];
        log(
          '[Problems] diagnostics:detail rx',
          keys.length,
          'files, sample:',
          JSON.stringify(sampleMarkers).slice(0, 300),
        );
        const stats = diagnosticsPayloadStats(payload);
        measureDiagnosticsLatency(
          'diagnostics_host_problems_update',
          stats,
          () => deps.updateProblemsPanel(payload),
        );
      } catch (err) {
        error('[Problems] update error:', err);
      }
    }
    if (method === EXPLORER_RPC_NOTIFICATIONS.diagnosticsDetail) {
      measureDiagnosticsLatency(
        'diagnostics_explorer_dispatch',
        diagnosticsPayloadStats(payload),
        () => dispatchExplorerNotification(method, payload),
      );
    } else {
      dispatchExplorerNotification(method, payload);
    }
  }

  function installVisibilityReconnect(): void {
    if (visibilityHandlerInstalled) return;
    visibilityHandlerInstalled = true;
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.visibilityState !== 'visible') return;
        explorerRpcConnection?.reconnect?.();
      } catch {}
    });
  }

  function ensureConnection(): ExplorerRpcConnection {
    if (explorerRpcConnection) return explorerRpcConnection;

    explorerRpcConnection = createExplorerRpcConnection({
      ensureSocketIoLoaded: deps.ensureSocketIoLoaded,
      onConnect: () => {
        log('[ExplorerRPC] Connected');
        if (explorerNeedsResync) {
          explorerNeedsResync = false;
        }
        try {
          handleExplorerReconnect();
        } catch (err) {
          warn('[ExplorerRPC] Connect resync failed:', err);
        }
      },
      onDisconnect: (reason) => {
        log('[ExplorerRPC] Disconnected', reason);
        explorerNeedsResync = true;
      },
      onConnectError: (err) => {
        warn('[ExplorerRPC] Connect error', err);
      },
      onNotification: (method, params) => {
        handleExplorerRpcNotification(method, params);
      },
    });

    installExplorerRpcClient({
      connect: () => ensureConnection().connect(),
      reconnect: () => ensureConnection().reconnect(),
      isConnected: () => ensureConnection().isConnected(),
      notify: (method, params = {}) => ensureConnection().notify(method, params || {}),
      request: (method, params = {}, timeoutMs) => (
        ensureConnection().request(method, params || {}, timeoutMs)
      ),
    });

    installVisibilityReconnect();
    return explorerRpcConnection;
  }

  async function connect(): Promise<ExplorerRpcConnection> {
    const connection = ensureConnection();
    await connection.connect().catch((err) => {
      warn('[ExplorerRPC] Failed to open explorer Socket.IO:', err);
      throw err;
    });
    return connection;
  }

  return {
    connect,
    reconnect(): void {
      ensureConnection().reconnect();
    },
    isConnected(): boolean {
      return ensureConnection().isConnected();
    },
    notify(method, params = {}): void {
      ensureConnection().notify(method, params);
    },
    request<TResult extends JsonObject = JsonObject>(
      method: ExplorerRpcMethod,
      params: JsonObject = {},
      timeoutMs?: number,
    ): Promise<TResult> {
      return ensureConnection().request<TResult>(method, params, timeoutMs);
    },
  };
}
