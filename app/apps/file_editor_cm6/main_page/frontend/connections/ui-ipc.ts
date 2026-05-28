// @ts-check

import { createUiIpcRpcConnection } from './ui-ipc-rpc.ts';
import { RPC_NOTIFICATION_EVENT, RPC_REQUEST_EVENT } from '../../../src/rpc/transport.ts';
import type { IoFactory, JsonObject, SocketLike } from '../../../src/rpc/transport.ts';
import { UI_IPC_RPC_METHODS, UI_IPC_RPC_NOTIFICATIONS } from '../../../src/ui_ipc/rpc_contract.ts';
import {
  SIDEBAR_IPC_RPC_METHODS,
  SIDEBAR_IPC_RPC_NOTIFICATIONS,
  parseSidebarIpcRpcNotification,
  type SidebarIpcRpcMethod,
  type SidebarIpcRpcNotificationMethod,
} from '../../../src/sidebar_ipc/rpc_contract.ts';
import {
  SOCKET_IO_NAMESPACES,
  SOCKET_IO_PATHS,
  fileEditorSocketQuery,
} from '../../../src/rpc/socketio-topology.ts';

interface ConsoleBridgeOptions {
  workerId?: string;
  workerLabel?: string;
  uniquePerWindow?: boolean;
  socketPath?: string;
  namespace?: string;
}

interface UiIpcConnectionsDeps {
  ensureSocketIoLoaded: () => Promise<IoFactory | null | undefined>;
  initConsoleBridge: (args: ConsoleBridgeOptions) => unknown;
  getClientId: () => string;
  onHostStateResync?: () => Promise<void> | void;
}

type UiIpcRpcConnection = ReturnType<typeof createUiIpcRpcConnection>;

export function createUiIpcConnections(deps: UiIpcConnectionsDeps) {
  let sidebarIpcSocket: SocketLike | null = null;
  let sidebarRpcRequestCounter = 0;
  let uiIpcRpcConnection: UiIpcRpcConnection | null = null;
  let uiIpcConnectPromise: Promise<UiIpcRpcConnection> | null = null;
  let consoleBridgePromise: Promise<void> | null = null;
  let consoleBridgeStarted = false;

  function startMainPageConsoleBridge(): Promise<void> {
    if (consoleBridgeStarted) return Promise.resolve();
    if (consoleBridgePromise) return consoleBridgePromise;
    consoleBridgePromise = deps.ensureSocketIoLoaded().then((io: IoFactory | null | undefined) => {
      if (!io) throw new Error('Socket.IO client is not available');
      const bridge = deps.initConsoleBridge({
        workerLabel: 'main_page',
        uniquePerWindow: true,
        socketPath: SOCKET_IO_PATHS.te2Console,
        namespace: '/te2_console',
      });
      if (!bridge) throw new Error('console bridge did not start');
      consoleBridgeStarted = true;
    }).catch((err: unknown) => {
      consoleBridgeStarted = false;
      consoleBridgePromise = null;
      console.warn('[console_bridge] main page start failed', err);
    });
    return consoleBridgePromise;
  }

  function activeFilePayloadFromOpenState(params: JsonObject): JsonObject {
    const openFile = typeof params.openFile === 'string' && params.openFile
      ? params.openFile
      : null;
    return {
      ...params,
      path: openFile,
      openState: params,
    };
  }

  function dispatchSidebarEvent(data: JsonObject): void {
    try {
      if (!data || typeof data !== 'object') return;
      window.dispatchEvent(new CustomEvent('cm6:sidebar-event', {
        detail: data,
      }));
    } catch (_) {}
  }

  function nextSidebarRpcRequestId(): string {
    sidebarRpcRequestCounter += 1;
    return `sidebar_ipc_${Date.now()}_${sidebarRpcRequestCounter}`;
  }

  function emitSidebarRpcRequest(method: SidebarIpcRpcMethod, params: JsonObject = {}): void {
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
        const data = response && typeof response === 'object' ? response as JsonObject : {};
        const error = data.error && typeof data.error === 'object' ? data.error as JsonObject : null;
        if (error) {
          console.warn('[Sidebar_IPC_RPC] request failed', method, error.message || error);
        }
      },
    );
  }

  function emitSidebarRpcNotification(method: SidebarIpcRpcNotificationMethod, params: JsonObject = {}): void {
    if (!sidebarIpcSocket || !sidebarIpcSocket.connected) return;
    sidebarIpcSocket.emit(RPC_REQUEST_EVENT, {
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
      dispatchWindowCustomEvent('cm6:sidebar-cwd-set', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.presence) {
      dispatchWindowCustomEvent('cm6:sidebar-presence', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.mention) {
      dispatchWindowCustomEvent('cm6:sidebar-mention', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.fileOpen) {
      dispatchWindowCustomEvent('cm6:sidebar-file-open', params);
    } else if (method === SIDEBAR_IPC_RPC_NOTIFICATIONS.projectOpened) {
      dispatchSidebarEvent({ type: method, payload: params });
      dispatchWindowCustomEvent('cm6:sidebar-project-opened', params);
    }
  }

  function dispatchWindowCustomEvent(eventName: string, data: unknown): void {
    try {
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: data && typeof data === 'object' ? data : {},
      }));
    } catch (_) {}
  }

  function connectSidebarIPC(): void {
    deps.ensureSocketIoLoaded().then((io: IoFactory | null | undefined) => {
      if (!io) return;
      if (sidebarIpcSocket) {
        if (!sidebarIpcSocket.connected) sidebarIpcSocket.connect?.();
        return;
      }
      const socket = io(SOCKET_IO_NAMESPACES.sidebarIpc, {
        path: SOCKET_IO_PATHS.uiIpc,
        transports: ['websocket'],
        query: fileEditorSocketQuery({ source: 'main_page' }),
      });
      sidebarIpcSocket = socket;
      socket.on('connect', () => {
        try {
          emitSidebarRpcRequest(SIDEBAR_IPC_RPC_METHODS.register, {
            role: 'host',
            app: 'file_editor_cm6',
            client_id: deps.getClientId(),
          });
        } catch (_) {}
        console.log('[Sidebar_IPC] main page connected');
      });
      socket.on(RPC_NOTIFICATION_EVENT, handleSidebarRpcNotification);
      socket.on('connect_error', (err: unknown) => {
        console.warn('[Sidebar_IPC] connect failed', err);
      });
    }).catch((err: unknown) => {
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
          try {
            void Promise.resolve(deps.onHostStateResync?.()).catch((error: unknown) => {
              console.warn('[UI_IPC_RPC] host state resync failed', error);
            });
          } catch (error) {
            console.warn('[UI_IPC_RPC] host state resync failed', error);
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
            document.dispatchEvent(new KeyboardEvent('keydown', {
              key: 's', code: 'KeyS', ctrlKey: true, bubbles: true,
            }));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorFocus) {
            console.log('[focus_relay] dispatching synthetic click');
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorReady) {
            dispatchWindowCustomEvent('cm6:editor-ready', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorOpenComplete) {
            dispatchWindowCustomEvent('cm6:editor-open-complete', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorCacheState) {
            dispatchWindowCustomEvent('cm6:editor-cache-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorDraftState) {
            dispatchWindowCustomEvent('cm6:editor-draft-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorScrollState) {
            dispatchWindowCustomEvent('cm6:editor-scroll-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorNotify) {
            dispatchWindowCustomEvent('cm6:editor-notify', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorDiagnosticsCounts) {
            dispatchWindowCustomEvent('cm6:editor-diagnostics-counts', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.hostActiveFileChanged) {
            dispatchWindowCustomEvent('cm6:active-file-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.openStateChanged) {
            dispatchWindowCustomEvent('cm6:open-state-changed', params);
            dispatchWindowCustomEvent('cm6:active-file-changed', activeFilePayloadFromOpenState(params));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitching) {
            dispatchWindowCustomEvent('cm6:project-switching', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.projectSwitched) {
            dispatchWindowCustomEvent('cm6:project-switched', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.adapterState) {
            dispatchWindowCustomEvent('cm6:adapter-state', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.preferencesChanged) {
            dispatchWindowCustomEvent('cm6:preferences-changed', params);
          }
        },
      });
    }

    const connection = uiIpcRpcConnection;
    uiIpcConnectPromise = startMainPageConsoleBridge().then(() => {
      return connection.connect();
    }).then(() => connection).catch((err: unknown) => {
      console.warn('[UI_IPC] connect failed', err);
      throw err;
    }).finally(() => {
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
    return await connection.request(UI_IPC_RPC_METHODS.hostFileRun, payload || {}, 8000);
  }

  async function requestBackendBootSnapshot(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostBootSnapshotGet, payload || {}, 8000);
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

  async function requestBackendRecordFileActivity(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostStateFileActivityRecord, payload || {}, 8000);
  }

  async function requestBackendUpdateFileScroll(payload: JsonObject = {}): Promise<unknown> {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostStateFileScrollUpdate, payload || {}, 8000);
  }

  function emitUiIpcNotification(method: keyof typeof UI_IPC_RPC_NOTIFICATIONS | string, params: JsonObject = {}): void {
    const resolved = Object.prototype.hasOwnProperty.call(UI_IPC_RPC_NOTIFICATIONS, method)
      ? UI_IPC_RPC_NOTIFICATIONS[method as keyof typeof UI_IPC_RPC_NOTIFICATIONS]
      : method;
    void connectUIIPC().then((connection) => {
      connection.notify(resolved as typeof UI_IPC_RPC_NOTIFICATIONS[keyof typeof UI_IPC_RPC_NOTIFICATIONS], params || {});
    }).catch((error: unknown) => {
      console.warn('[UI_IPC_RPC] notification emit failed', resolved, error);
    });
  }

  return {
    emitSidebarRpcRequest,
    emitSidebarRpcNotification,
    emitUiIpcNotification,
    connectSidebarIPC,
    connectUIIPC,
    requestBackendFileOpen,
    requestBackendFileSave,
    requestBackendDraftDiscard,
    requestBackendEditorPreferenceUpdate,
    requestBackendRunActiveFile,
    requestBackendBootSnapshot,
    requestBackendEditorJumpToLine,
    requestBackendEditorGitBaselines,
    requestBackendEditorFind,
    requestBackendEditorCommand,
    requestBackendEditorIssuesCommand,
    requestBackendEditorIssuesDump,
    requestBackendDiagnosticsMention,
    requestBackendRecordFileActivity,
    requestBackendUpdateFileScroll,
  };
}
