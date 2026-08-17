// @ts-check

import { createUiIpcRpcConnection } from './ui-ipc-rpc.ts';
import { RPC_NOTIFICATION_EVENT, RPC_REQUEST_EVENT } from '../../../src/rpc/transport.ts';
import type { IoFactory, JsonObject, SocketLike } from '../../../src/rpc/transport.ts';
import { UI_IPC_RPC_METHODS, UI_IPC_RPC_NOTIFICATIONS, type UiIpcRpcMethod } from '../../../src/ui_ipc/rpc_contract.ts';
import { SIDEBAR_IPC_RPC_METHODS, SIDEBAR_IPC_RPC_NOTIFICATIONS, parseSidebarIpcRpcNotification, type SidebarIpcRpcMethod, type SidebarIpcRpcNotificationMethod } from '../../../src/sidebar_ipc/rpc_contract.ts';
import { SOCKET_IO_NAMESPACES, SOCKET_IO_PATHS, fileEditorSocketQuery } from '../../../src/rpc/socketio-topology.ts';

interface ConsoleBridgeOptions {
  workerId?: string;
  workerLabel?: string;
  uniquePerWindow?: boolean;
  socketPath?: string;
  namespace?: string;
}

interface ElectronAppViewIdentityHint {
  client?: unknown;
  surface?: unknown;
  consoleWorkerLabel?: unknown;
}

interface ElectronAppViewHintWindow {
  te2Electron?: {
    identity?: ElectronAppViewIdentityHint;
  };
}

interface UiIpcConnectionsDeps {
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  initConsoleBridge: (args: ConsoleBridgeOptions) => unknown;
  getClientId: () => string;
  getConsoleWorkerId: () => string;
  onHostStateResync?: () => Promise<void> | void;
  onSidebarConnected?: () => void;
}

type UiIpcRpcConnection = ReturnType<typeof createUiIpcRpcConnection>;

interface SidebarRuntimeEventWindow {
  __codeTe2SidebarRuntimeReady?: boolean;
  __codeTe2PendingSidebarEvents?: JsonObject[];
}

export function createUiIpcConnections(deps: UiIpcConnectionsDeps) {
  let sidebarIpcSocket: SocketLike | null = null;
  let sidebarRpcRequestCounter = 0;
  let uiIpcRpcConnection: UiIpcRpcConnection | null = null;
  let uiIpcConnectPromise: Promise<UiIpcRpcConnection> | null = null;
  let consoleBridgePromise: Promise<void> | null = null;
  let consoleBridgeStarted = false;
  let uiIpcHasConnected = false;

  function consoleWorkerLabel(): string {
    const identity = (window as unknown as ElectronAppViewHintWindow).te2Electron?.identity;
    const label = typeof identity?.consoleWorkerLabel === 'string'
      ? identity.consoleWorkerLabel.trim()
      : '';
    return identity?.client === 'electron' &&
      identity?.surface === 'framework-app-view' &&
      label
      ? label
      : 'main_page';
  }

  function startMainPageConsoleBridge(): Promise<void> {
    if (consoleBridgeStarted) return Promise.resolve();
    if (consoleBridgePromise) return consoleBridgePromise;
    consoleBridgePromise = deps
      .ensureSocketIoLoaded()
      .then((io: IoFactory | null | undefined) => {
        if (!io) throw new Error('Socket.IO client is not available');
        const bridge = deps.initConsoleBridge({
          workerId: deps.getConsoleWorkerId(),
          workerLabel: consoleWorkerLabel(),
          socketPath: SOCKET_IO_PATHS.te2Console,
          namespace: '/te2_console',
        });
        if (!bridge) throw new Error('console bridge did not start');
        consoleBridgeStarted = true;
      })
      .catch((err: unknown) => {
        consoleBridgeStarted = false;
        consoleBridgePromise = null;
        console.warn('[console_bridge] main page start failed', err);
      });
    return consoleBridgePromise;
  }

  function activeFilePayloadFromOpenState(params: JsonObject): JsonObject {
    const openFile = typeof params.openFile === 'string' && params.openFile ? params.openFile : null;
    return {
      ...params,
      path: openFile,
      openState: params,
    };
  }

  function dispatchSidebarEvent(data: JsonObject): void {
    try {
      if (!data || typeof data !== 'object') return;
      const detail = { ...data };
      const runtimeWindow = window as unknown as SidebarRuntimeEventWindow;
      if (!runtimeWindow.__codeTe2SidebarRuntimeReady) {
        const pending = Array.isArray(runtimeWindow.__codeTe2PendingSidebarEvents) ? runtimeWindow.__codeTe2PendingSidebarEvents : [];
        pending.push(detail);
        if (pending.length > 24) pending.splice(0, pending.length - 24);
        runtimeWindow.__codeTe2PendingSidebarEvents = pending;
      }
      window.dispatchEvent(
        new CustomEvent('code-te2:sidebar-event', {
          detail,
        }),
      );
    } catch (_) {}
  }

  function sidebarNotificationTargetsThisClient(params: JsonObject): boolean {
    const targetClientId = String(
      params.clientId || params.client_id || "",
    ).trim();
    return !targetClientId || targetClientId === deps.getClientId();
  }

  function nextSidebarRpcRequestId(): string {
    sidebarRpcRequestCounter += 1;
    return `sidebar_ipc_${Date.now()}_${sidebarRpcRequestCounter}`;
  }

  function emitSidebarRpcRequest(method: SidebarIpcRpcMethod, params: JsonObject = {}, onResult?: (result: JsonObject) => void): void {
    if (!sidebarIpcSocket || !sidebarIpcSocket.connected) return;
    sidebarIpcSocket.emit(
      RPC_REQUEST_EVENT,
      {
        jsonrpc: '2.0',
        id: nextSidebarRpcRequestId(),
        method,
        params,
      },
      (response: unknown) => {
        const data = response && typeof response === 'object' ? (response as JsonObject) : {};
        const error = data.error && typeof data.error === 'object' ? (data.error as JsonObject) : null;
        if (error) {
          console.warn('[Sidebar_IPC_RPC] request failed', method, error.message || error);
          return;
        }
        if (onResult) {
          const result = data.result && typeof data.result === 'object' ? (data.result as JsonObject) : data;
          onResult(result);
        }
      },
    );
  }

  function requestSidebarUiControl(method: UiIpcRpcMethod, params: JsonObject = {}): void {
    void connectUIIPC()
      .then((connection) => {
        return connection.request(
          method,
          {
            ...params,
            client_id: deps.getClientId(),
            clientId: deps.getClientId(),
          },
          8000,
        );
      })
      .catch((error: unknown) => {
        console.warn('[UI_IPC_RPC] sidebar control request failed', method, error);
      });
  }

  function emitSidebarRpcNotification(method: SidebarIpcRpcNotificationMethod, params: JsonObject = {}): void {
    if (!sidebarIpcSocket || !sidebarIpcSocket.connected) return;
    sidebarIpcSocket.volatile.emit(RPC_REQUEST_EVENT, {
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  function handleSidebarRpcNotification(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const parsed = parseSidebarIpcRpcNotification(payload as JsonObject);
    if (!parsed) return;
    const { method, params } = parsed;
    if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.clientState) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.windowsChanged) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.windowActivated) {
      if (sidebarNotificationTargetsThisClient(params)) {
        dispatchSidebarEvent({ type: method, payload: params });
      }
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.windowReadinessChanged) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.activeShortcutRefresh) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerState) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerOpen) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerClose) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.drawerToggle) {
      dispatchSidebarEvent({ type: method, payload: params });
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.cwdSet) {
      dispatchWindowCustomEvent('code-te2:sidebar-cwd-set', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.presence) {
      dispatchWindowCustomEvent('code-te2:sidebar-presence', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.mention) {
      dispatchWindowCustomEvent('code-te2:sidebar-mention', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.fileOpen) {
      dispatchWindowCustomEvent('code-te2:sidebar-file-open', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.projectOpened) {
      dispatchSidebarEvent({ type: method, payload: params });
      dispatchWindowCustomEvent('code-te2:sidebar-project-opened', params);
    }
  }

  function dispatchWindowCustomEvent(eventName: string, data: unknown): void {
    try {
      window.dispatchEvent(
        new CustomEvent(eventName, {
          detail: data && typeof data === 'object' ? data : {},
        }),
      );
    } catch (_) {}
  }

  function connectSidebarIPC(): void {
    deps
      .ensureSocketIoLoaded()
      .then((io: IoFactory | null | undefined) => {
        if (!io) return;
        if (sidebarIpcSocket) {
          if (!sidebarIpcSocket.connected) sidebarIpcSocket.connect?.();
          return;
        }
        const socket = io(SOCKET_IO_NAMESPACES.sidebarIpc, {
          path: SOCKET_IO_PATHS.uiIpc,
          transports: ['websocket'],
          query: fileEditorSocketQuery(),
        });
        sidebarIpcSocket = socket;
        socket.on('connect', () => {
          try {
            emitSidebarRpcRequest(
              SIDEBAR_IPC_RPC_METHODS.register,
              {
                role: 'host',
                app: 'code_te2',
                client_id: deps.getClientId(),
              },
              () => deps.onSidebarConnected?.(),
            );
            emitSidebarRpcRequest(
              SIDEBAR_IPC_RPC_METHODS.windowsList,
              {
                client_id: deps.getClientId(),
              },
              (result) => {
                dispatchSidebarEvent({
                  type: SIDEBAR_IPC_RPC_NOTIFICATIONS.windowsChanged,
                  payload: result,
                });
              },
            );
          } catch (_) {}
          console.log('[Sidebar_IPC] main page connected');
        });
        socket.on(RPC_NOTIFICATION_EVENT, handleSidebarRpcNotification);
        socket.on('connect_error', (err: unknown) => {
          console.warn('[Sidebar_IPC] connect failed', err);
        });
      })
      .catch((err: unknown) => {
        console.warn('[Sidebar_IPC] load failed', err);
      });
  }

  function connectUIIPC(): Promise<UiIpcRpcConnection> {
    if (uiIpcRpcConnection && uiIpcRpcConnection.isConnected()) return Promise.resolve(uiIpcRpcConnection);
    if (uiIpcConnectPromise) return uiIpcConnectPromise;
    if (!uiIpcRpcConnection) {
      uiIpcRpcConnection = createUiIpcRpcConnection({
        ensureSocketIoLoaded: deps.ensureSocketIoLoaded,
        onConnect: () => {
          console.log('[UI_IPC_RPC] main page connected');
          const reconnect = uiIpcHasConnected;
          uiIpcHasConnected = true;
          if (reconnect) {
            try {
              void Promise.resolve(deps.onHostStateResync?.()).catch((error: unknown) => {
                console.warn('[UI_IPC_RPC] host state resync failed', error);
              });
            } catch (error) {
              console.warn('[UI_IPC_RPC] host state resync failed', error);
            }
          }
        },
        onDisconnect: (reason) => {
          console.log('[UI_IPC_RPC] main page disconnected', reason);
        },
        onConnectError: (err) => {
          console.warn('[UI_IPC_RPC] connect failed', err);
        },
        onNotification: (method, params) => {
          if (method === UI_IPC_RPC_NOTIFICATIONS.editorSave) {
            document.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 's',
                code: 'KeyS',
                ctrlKey: true,
                bubbles: true,
              }),
            );
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorFocus) {
            console.log('[focus_relay] dispatching synthetic click');
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorReady) {
            dispatchWindowCustomEvent('code-te2:editor-ready', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorOpenComplete) {
            dispatchWindowCustomEvent('code-te2:editor-open-complete', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorCacheState) {
            dispatchWindowCustomEvent('code-te2:editor-cache-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorDraftState) {
            dispatchWindowCustomEvent('code-te2:editor-draft-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorScrollState) {
            dispatchWindowCustomEvent('code-te2:editor-scroll-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorNotify) {
            dispatchWindowCustomEvent('code-te2:editor-notify', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorDiagnosticsCounts) {
            dispatchWindowCustomEvent('code-te2:editor-diagnostics-counts', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.hostActiveFileChanged) {
            dispatchWindowCustomEvent('code-te2:active-file-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.openStateChanged) {
            dispatchWindowCustomEvent('code-te2:open-state-changed', params);
            dispatchWindowCustomEvent('code-te2:active-file-changed', activeFilePayloadFromOpenState(params));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.fileTabsDecorationsChanged) {
            dispatchWindowCustomEvent('code-te2:file-tabs-decorations-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitching) {
            dispatchWindowCustomEvent('code-te2:project-switching', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitched) {
            dispatchWindowCustomEvent('code-te2:project-switched', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.adapterState) {
            dispatchWindowCustomEvent('code-te2:adapter-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.preferencesChanged) {
            dispatchWindowCustomEvent('code-te2:preferences-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.terminalOpen) {
            dispatchWindowCustomEvent('code-te2:terminal-open', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.codeInspectorChanged) {
            dispatchWindowCustomEvent('code-te2:code-inspector-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.runProfileStateChanged) {
            dispatchWindowCustomEvent('code-te2:run-profile-state-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.sidebarWindowsChanged) {
            dispatchSidebarEvent({
              type: SIDEBAR_IPC_RPC_NOTIFICATIONS.windowsChanged,
              payload: params,
            });
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.sidebarWindowActivated) {
            if (sidebarNotificationTargetsThisClient(params)) {
              dispatchSidebarEvent({
                type: SIDEBAR_IPC_RPC_NOTIFICATIONS.windowActivated,
                payload: params,
              });
            }
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.sidebarWindowReadinessChanged) {
            dispatchSidebarEvent({
              type: SIDEBAR_IPC_RPC_NOTIFICATIONS.windowReadinessChanged,
              payload: params,
            });
          }
        },
      });
    }

    const connection = uiIpcRpcConnection;
    uiIpcConnectPromise = connection.connect()
      .then(() => {
        // Console observability is optional and must never gate core UI IPC or
        // the editor boot sequence.
        void startMainPageConsoleBridge();
        return connection;
      })
      .catch((err: unknown) => {
        console.warn('[UI_IPC] connect failed', err);
        throw err;
      })
      .finally(() => {
        uiIpcConnectPromise = null;
      });
    return uiIpcConnectPromise;
  }

  async function requestBackendFileOpen(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostFileOpen, payload || {}, 8000);
  }

  async function requestBackendFileSave(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostFileSave, payload || {}, 8000);
  }

  async function requestBackendDraftDiscard(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostDraftDiscard, payload || {}, 8000);
  }

  async function requestBackendEditorPreferenceUpdate(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorPreferenceUpdate, payload || {}, 8000);
  }

  async function requestBackendRunActiveFile(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostFileRun, payload || {}, 60000);
  }

  async function requestBackendBootSnapshot(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostBootSnapshotGet, payload || {}, 8000);
  }

  async function requestBackendLanguageBackendSet(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(
      UI_IPC_RPC_METHODS.hostLanguageBackendSet,
      payload || {},
      20 * 60 * 1000,
    );
  }

  async function requestBackendEditorJumpToLine(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorJumpToLine, payload || {}, 8000);
  }

  async function requestBackendEditorGitBaselines(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorGitBaselinesGet, payload || {}, 8000);
  }

  async function requestBackendEditorFind(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorFind, payload || {}, 8000);
  }

  async function requestBackendEditorCommand(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorCommand, payload || {}, 8000);
  }

  async function requestBackendEditorIssuesCommand(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorIssuesCommand, payload || {}, 8000);
  }

  async function requestBackendEditorIssuesDump(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorIssuesDump, payload || {}, 12000);
  }

  async function requestBackendDiagnosticsMention(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostDiagnosticsMention, payload || {}, 8000);
  }

  async function requestBackendUpdateFileScroll(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostStateFileScrollUpdate, payload || {}, 8000);
  }

  async function requestUiIpc(method: UiIpcRpcMethod, payload: JsonObject = {}, timeoutMs = 8000): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(method, payload || {}, timeoutMs);
  }

  function emitUiIpcNotification(method: keyof typeof UI_IPC_RPC_NOTIFICATIONS | string, params: JsonObject = {}): void {
    const resolved = Object.prototype.hasOwnProperty.call(UI_IPC_RPC_NOTIFICATIONS, method) ? UI_IPC_RPC_NOTIFICATIONS[method as keyof typeof UI_IPC_RPC_NOTIFICATIONS] : method;
    void connectUIIPC()
      .then((connection) => {
        connection.notify(resolved as (typeof UI_IPC_RPC_NOTIFICATIONS)[keyof typeof UI_IPC_RPC_NOTIFICATIONS], params || {});
      })
      .catch((error: unknown) => {
        console.warn('[UI_IPC_RPC] notification emit failed', resolved, error);
      });
  }

  return {
    emitSidebarRpcRequest,
    emitSidebarRpcNotification,
    emitUiIpcNotification,
    requestSidebarUiControl,
    connectSidebarIPC,
    connectUIIPC,
    requestBackendFileOpen,
    requestBackendFileSave,
    requestBackendDraftDiscard,
    requestBackendEditorPreferenceUpdate,
    requestBackendRunActiveFile,
    requestBackendBootSnapshot,
    requestBackendLanguageBackendSet,
    requestBackendEditorJumpToLine,
    requestBackendEditorGitBaselines,
    requestBackendEditorFind,
    requestBackendEditorCommand,
    requestBackendEditorIssuesCommand,
    requestBackendEditorIssuesDump,
    requestBackendDiagnosticsMention,
    requestBackendUpdateFileScroll,
    requestUiIpc,
  };
}
