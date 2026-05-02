// @ts-check

import { isRunnableFile } from '../utils.ts';
import { createUiIpcRpcConnection } from './ui-ipc-rpc.ts';
import { UI_IPC_RPC_METHODS, UI_IPC_RPC_NOTIFICATIONS } from '../../ui_ipc/rpc_contract.ts';

/**
 * @param {{
 *   ensureSocketIoLoaded: () => Promise<any>,
 *   initConsoleBridge: (args: { workerId: string, socketPath?: string, namespace?: string }) => void,
 *   getClientId: () => string
 * }} deps
 */
export function createUiIpcConnections(deps) {
  let sidebarIpcSocket = null;
  let uiIpcRpcConnection = null;
  let uiIpcConnectPromise = null;

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
            window.dispatchEvent(new CustomEvent('cm6:mention-request', {
              detail: params,
            }));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.hostActiveFileChanged) {
            applyActiveFileChangedUiState(params);
            window.dispatchEvent(new CustomEvent('cm6:active-file-changed', {
              detail: params,
            }));
          } else if (method === UI_IPC_RPC_NOTIFICATIONS.adapterState) {
            window.dispatchEvent(new CustomEvent('cm6:adapter-state', {
              detail: params,
            }));
          }
        },
      });

      deps.initConsoleBridge({
        workerId: 'main_page',
        socketPath: '/te2_console_ws/socket.io',
        namespace: '/te2_console',
      });
    }

    uiIpcConnectPromise = uiIpcRpcConnection.connect().then(() => uiIpcRpcConnection).catch((err) => {
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

  return {
    emitSidebarIpc,
    connectSidebarIPC,
    connectUIIPC,
    requestBackendFileOpen,
    requestBackendFileSave,
    requestBackendEditorPreferenceUpdate,
    requestBackendRunActiveFile,
    requestBackendBootSnapshot,
  };
}
