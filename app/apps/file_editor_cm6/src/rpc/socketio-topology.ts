import { RPC_NAMESPACES } from './namespaces.ts';

export const FILE_EDITOR_CM6_APP_ID = 'file_editor_cm6' as const;

export const SOCKET_IO_PATHS = {
  editor: '/editor_ws/socket.io',
  explorer: '/explorer_ws/socket.io',
  terminal: '/terminal_ws/socket.io',
  te2Console: '/te2_console_ws/socket.io',
  uiIpc: '/ui_ipc_ws/socket.io',
  wba: '/wba_ws/socket.io',
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
    app_id: FILE_EDITOR_CM6_APP_ID,
    ...extra,
  };
}
