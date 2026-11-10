import { RPC_NAMESPACES } from './namespaces.ts';

export const CODE_TE2_APP_ID = 'code_te2' as const;

export const APP_WORKER_SOCKET_IO_PATH = `/api/app/${CODE_TE2_APP_ID}/socket.io` as const;
export const WBA_SOCKET_IO_PATH = `/api/app/${CODE_TE2_APP_ID}/services/wba/socket.io` as const;

// Try the app-worker RPC over HTTP immediately; Engine.IO upgrades to WebSocket
// without replacing the connected namespace session.
export const APP_WORKER_SOCKET_IO_TRANSPORTS = ['polling', 'websocket'] as const;

export const SOCKET_IO_PATHS = {
  editor: APP_WORKER_SOCKET_IO_PATH,
  explorer: APP_WORKER_SOCKET_IO_PATH,
  terminal: APP_WORKER_SOCKET_IO_PATH,
  te2Console: '/te2_console_ws/socket.io',
  uiIpc: APP_WORKER_SOCKET_IO_PATH,
  wba: WBA_SOCKET_IO_PATH,
} as const;

export const SOCKET_IO_NAMESPACES = {
  editorRpc: RPC_NAMESPACES.editor,
  explorerRpc: RPC_NAMESPACES.explorer,
  sidebarIpc: RPC_NAMESPACES.sidebarIpc,
  terminal: RPC_NAMESPACES.terminal,
  uiIpc: RPC_NAMESPACES.uiIpc,
  wba: RPC_NAMESPACES.wba,
} as const;

export interface SocketClientIdentity {
  clientInstanceId: string;
  mainPageClientInstanceId?: string;
  windowId?: string | null;
  clientRole?: 'primary' | 'secondary';
}

let socketClientIdentity: Readonly<SocketClientIdentity> | null = null;

export function configureCodeTe2SocketIdentity(
  identity: SocketClientIdentity,
): void {
  socketClientIdentity = normalizeCodeTe2SocketIdentity(identity);
}

export function normalizeCodeTe2SocketIdentity(identity: SocketClientIdentity): Readonly<SocketClientIdentity> {
  const clientInstanceId = String(identity.clientInstanceId || '').trim().toLowerCase();
  const windowId = String(identity.windowId || '').trim().toLowerCase();
  const clientRole = identity.clientRole === 'secondary' ? 'secondary' : 'primary';
  const mainPageClientInstanceId = identity.mainPageClientInstanceId || (clientRole === 'primary' ? clientInstanceId : '');
  if (!/^client_[a-z0-9]{12,64}$/.test(mainPageClientInstanceId)
      || (clientRole === 'primary' && mainPageClientInstanceId !== clientInstanceId)) {
    throw new Error('Code TE2 logical main-page identity is invalid');
  }
  if (!/^client_[a-z0-9]{12,64}$/.test(clientInstanceId)) {
    throw new Error('Code TE2 socket client identity is invalid');
  }
  if (windowId && !/^window_[a-z0-9]{20,64}$/.test(windowId)) {
    throw new Error('Code TE2 socket window identity is invalid');
  }
  return Object.freeze({
    clientInstanceId,
    mainPageClientInstanceId,
    windowId: windowId || null,
    clientRole,
  });
}

export function getCodeTe2SocketIdentity(): Readonly<SocketClientIdentity> {
  if (socketClientIdentity === null) throw new Error('Code TE2 socket identity has not been configured');
  return socketClientIdentity;
}

export function codeTe2SocketQuery(identity: Readonly<SocketClientIdentity>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app_id: CODE_TE2_APP_ID,
    client_instance_id: identity.clientInstanceId,
    main_page_client_instance_id: identity.mainPageClientInstanceId,
    client_role: identity.clientRole,
    ...(identity.windowId ? { window_id: identity.windowId } : {}),
    ...extra,
  };
}

export function fileEditorSocketQuery(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return codeTe2SocketQuery(getCodeTe2SocketIdentity(), extra);
}
