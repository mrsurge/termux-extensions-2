export const RPC_NAMESPACES = {
  explorer: '/rpc/explorer',
} as const;

export type RpcNamespaceName = keyof typeof RPC_NAMESPACES;
