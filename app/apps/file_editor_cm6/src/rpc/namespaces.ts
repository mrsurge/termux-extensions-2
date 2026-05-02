export const RPC_NAMESPACES = {
  explorer: '/rpc/explorer',
  uiIpc: '/ui_ipc',
} as const;

export type RpcNamespaceName = keyof typeof RPC_NAMESPACES;
