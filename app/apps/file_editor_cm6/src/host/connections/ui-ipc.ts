// @ts-check

/**
 * @param {{
 *   ensureSocketIoLoaded: () => Promise<any>,
 *   initConsoleBridge: (args: { workerId: string, socket: any }) => void,
 *   getClientId: () => string
 * }} deps
 */
export function createUiIpcConnections(deps) {
  let sidebarIpcSocket = null;
  let uiIpcSocket = null;

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
    deps.ensureSocketIoLoaded().then((io) => {
      if (!io) return;
      uiIpcSocket = io('/ui_ipc', {
        path: '/ui_ipc_ws/socket.io',
        transports: ['websocket'],
        query: { app_id: 'file_editor_cm6', source: 'main_page' },
      });
      uiIpcSocket.on('connect', () => {
        console.log('[UI_IPC] main page connected');
      });
      uiIpcSocket.on('ui_event', (data) => {
        if (!data || typeof data !== 'object') return;
        console.log('[focus_relay] main got ui_event', data.type);
        if (data.type === 'save') {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 's', code: 'KeyS', ctrlKey: true, bubbles: true,
          }));
        } else if (data.type === 'focus') {
          console.log('[focus_relay] dispatching synthetic click');
          document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else if (data.type === 'mention_request') {
          console.log('[mention] UI IPC received mention_request');
          window.dispatchEvent(new CustomEvent('cm6:mention-request', {
            detail: data,
          }));
        } else if (data.type === 'adapter_state') {
          window.dispatchEvent(new CustomEvent('cm6:adapter-state', {
            detail: data,
          }));
        }
      });

      deps.initConsoleBridge({ workerId: 'main_page', socket: uiIpcSocket });
    }).catch((err) => {
      console.warn('[UI_IPC] connect failed', err);
    });
  }

  return { emitSidebarIpc, connectSidebarIPC, connectUIIPC };
}
