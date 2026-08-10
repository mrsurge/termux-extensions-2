export const RPC_NAMESPACES = {
  editor: '/rpc/editor',
  explorer: '/rpc/explorer',
  sidebarIpc: '/sidebar_ipc',
  terminal: '/terminal',
  uiIpc: '/ui_ipc',
  wba: '/wba',
} as const;

export type RpcNamespaceName = keyof typeof RPC_NAMESPACES;
