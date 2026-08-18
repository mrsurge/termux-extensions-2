import { RPC_NAMESPACES } from './namespaces.ts';

export const CODE_TE2_APP_ID = 'code_te2' as const;

export const APP_WORKER_SOCKET_IO_PATH = `/api/app/${CODE_TE2_APP_ID}/socket.io` as const;
export const WBA_SOCKET_IO_PATH = `/api/app/${CODE_TE2_APP_ID}/services/wba/socket.io` as const;

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

interface SocketClientIdentity {
  clientInstanceId: string;
  windowId?: string | null;
}

let socketClientIdentity: Readonly<SocketClientIdentity> | null = null;

export function configureCodeTe2SocketIdentity(
  identity: SocketClientIdentity,
): void {
  const clientInstanceId = String(identity.clientInstanceId || '').trim().toLowerCase();
  const windowId = String(identity.windowId || '').trim().toLowerCase();
  if (!/^client_[a-z0-9]{12,64}$/.test(clientInstanceId)) {
    throw new Error('Code TE2 socket client identity is invalid');
  }
  if (windowId && !/^window_[a-z0-9]{20,64}$/.test(windowId)) {
    throw new Error('Code TE2 socket window identity is invalid');
  }
  socketClientIdentity = Object.freeze({
    clientInstanceId,
    windowId: windowId || null,
  });
}

export function fileEditorSocketQuery(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (socketClientIdentity === null) {
    throw new Error('Code TE2 socket identity has not been configured');
  }
  return {
    app_id: CODE_TE2_APP_ID,
    client_instance_id: socketClientIdentity.clientInstanceId,
    ...(socketClientIdentity.windowId
      ? { window_id: socketClientIdentity.windowId }
      : {}),
    ...extra,
  };
}
