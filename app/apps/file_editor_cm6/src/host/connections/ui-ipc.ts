// @ts-check

import { isRunnableFile } from '../utils.ts';
import { createUiIpcRpcConnection } from './ui-ipc-rpc.ts';
import { UI_IPC_RPC_METHODS, UI_IPC_RPC_NOTIFICATIONS } from '../../ui_ipc/rpc_contract.ts';

/**
 * @param {{
 *   ensureSocketIoLoaded: () => Promise<any>,
 *   initConsoleBridge: (args: { workerId?: string, workerLabel?: string, uniquePerWindow?: boolean, socketPath?: string, namespace?: string }) => unknown,
 *   getClientId: () => string
 * }} deps
 */
export function createUiIpcConnections(deps) {
  let sidebarIpcSocket = null;
  let uiIpcRpcConnection = null;
  let uiIpcConnectPromise = null;
  let consoleBridgePromise = null;
  let consoleBridgeStarted = false;

  function startMainPageConsoleBridge() {
    if (consoleBridgeStarted) return Promise.resolve();
    if (consoleBridgePromise) return consoleBridgePromise;
    consoleBridgePromise = deps.ensureSocketIoLoaded().then((io) => {
      if (!io) throw new Error('Socket.IO client is not available');
      const bridge = deps.initConsoleBridge({
        workerLabel: 'main_page',
        uniquePerWindow: true,
        socketPath: '/te2_console_ws/socket.io',
        namespace: '/te2_console',
      });
      if (!bridge) throw new Error('console bridge did not start');
      consoleBridgeStarted = true;
    }).catch((err) => {
      consoleBridgeStarted = false;
      consoleBridgePromise = null;
      console.warn('[console_bridge] main page start failed', err);
    });
    return consoleBridgePromise;
  }

  function applyActiveFileChangedUiState(data) {
    try {
      const filePath = typeof data?.path === 'string' ? data.path : '';
      if (!filePath) return;
      try { window.currentPath = filePath; } catch (_) {}
      const trimmed = filePath.replace(/\/+$/, '');
      const idx = trimmed.lastIndexOf('/');
      const fileName = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
      const fileNameEl = document.getElementById('fe-file-name');
      if (fileNameEl) {
        fileNameEl.textContent = fileName || 'Untitled';
        fileNameEl.title = fileName || 'Untitled';
      }
      const runActiveBtn = document.getElementById('run-active-file-btn');
      if (runActiveBtn instanceof HTMLButtonElement) {
        const runnable = isRunnableFile(filePath);
        runActiveBtn.disabled = !runnable;
        runActiveBtn.title = runnable
          ? 'Run active file in terminal'
          : 'Open a Python, shell, or C/C++ source file to enable running';
      }
    } catch (_) {}
  }

  function dispatchSidebarEvent(data) {
    try {
      if (!data || typeof data !== 'object') return;
      window.dispatchEvent(new CustomEvent('cm6:sidebar-event', {
        detail: data,
      }));
    } catch (_) {}
  }

  function dispatchWindowCustomEvent(eventName, data) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: data && typeof data === 'object' ? data : {},
      }));
    } catch (_) {}
  }

  function emitSidebarIpc(eventName, payload) {
    try {
      if (eventName === 'sidebar:event' && payload && typeof payload === 'object') {
        dispatchSidebarEvent(payload);
      }
      if (!sidebarIpcSocket || !sidebarIpcSocket.connected) return;
      sidebarIpcSocket.emit(eventName, payload || {});
    } catch (_) {}
  }

  function connectSidebarIPC() {
    deps.ensureSocketIoLoaded().then((io) => {
      if (!io) return;
      if (sidebarIpcSocket) {
        if (!sidebarIpcSocket.connected) sidebarIpcSocket.connect();
        return;
      }
      sidebarIpcSocket = io('/sidebar_ipc', {
        path: '/ui_ipc_ws/socket.io',
        transports: ['websocket'],
        query: { app_id: 'file_editor_cm6', source: 'main_page' },
      });
      sidebarIpcSocket.on('connect', () => {
        try {
          sidebarIpcSocket.emit('sidebar:register', {
            role: 'host',
            app: 'file_editor_cm6',
            client_id: deps.getClientId(),
          });
        } catch (_) {}
        console.log('[Sidebar_IPC] main page connected');
      });
      sidebarIpcSocket.on('sidebar:agent_edit', (data) => {
        if (!data || typeof data !== 'object') return;
      });
      sidebarIpcSocket.on('sidebar:event', (data) => {
        if (!data || typeof data !== 'object') return;
        dispatchSidebarEvent(data);
      });
      sidebarIpcSocket.on('connect_error', (err) => {
        console.warn('[Sidebar_IPC] connect failed', err);
      });
    }).catch((err) => {
      console.warn('[Sidebar_IPC] load failed', err);
    });
  }

  function connectUIIPC() {
    if (uiIpcRpcConnection && uiIpcRpcConnection.isConnected()) return Promise.resolve(uiIpcRpcConnection);
    if (uiIpcConnectPromise) return uiIpcConnectPromise;
    if (!uiIpcRpcConnection) {
      uiIpcRpcConnection = createUiIpcRpcConnection({
        ensureSocketIoLoaded: deps.ensureSocketIoLoaded,
        onConnect: () => {
          console.log('[UI_IPC_RPC] main page connected');
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
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.editorMentionRequest) {
            console.log('[mention] UI IPC RPC received mention request');
            dispatchWindowCustomEvent('cm6:mention-request', params);
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
            applyActiveFileChangedUiState(params);
            dispatchWindowCustomEvent('cm6:active-file-changed', params);
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.adapterState) {
            dispatchWindowCustomEvent('cm6:adapter-state', params);
          }
        },
      });

    }

    uiIpcConnectPromise = startMainPageConsoleBridge().then(() => {
      return uiIpcRpcConnection.connect();
    }).then(() => uiIpcRpcConnection).catch((err) => {
      console.warn('[UI_IPC] connect failed', err);
      throw err;
    }).finally(() => {
      uiIpcConnectPromise = null;
    });
    return uiIpcConnectPromise;
  }

  async function requestBackendFileOpen(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostFileOpen, payload || {}, 8000);
  }

  async function requestBackendFileSave(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostFileSave, payload || {}, 8000);
  }

  async function requestBackendEditorPreferenceUpdate(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorPreferenceUpdate, payload || {}, 8000);
  }

  async function requestBackendRunActiveFile(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostFileRun, payload || {}, 8000);
  }

  async function requestBackendBootSnapshot(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostBootSnapshotGet, payload || {}, 8000);
  }

  async function requestBackendEditorJumpToLine(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorJumpToLine, payload || {}, 8000);
  }

  async function requestBackendEditorGitBaselines(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorGitBaselinesGet, payload || {}, 8000);
  }

  async function requestBackendEditorFind(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorFind, payload || {}, 8000);
  }

  async function requestBackendEditorIssuesCommand(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorIssuesCommand, payload || {}, 8000);
  }

  async function requestBackendEditorIssuesDump(payload) {
    const connection = await connectUIIPC();
    return await connection.request(UI_IPC_RPC_METHODS.hostEditorIssuesDump, payload || {}, 12000);
  }

  return {
    emitSidebarIpc,
    connectSidebarIPC,
    connectUIIPC,
    requestBackendFileOpen,
    requestBackendFileSave,
    requestBackendEditorPreferenceUpdate,
    requestBackendRunActiveFile,
    requestBackendBootSnapshot,
    requestBackendEditorJumpToLine,
    requestBackendEditorGitBaselines,
    requestBackendEditorFind,
    requestBackendEditorIssuesCommand,
    requestBackendEditorIssuesDump,
  };
}
