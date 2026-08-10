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

export function fileEditorSocketQuery(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    app_id: CODE_TE2_APP_ID,
    ...extra,
  };
}
