export const LEGACY_APPSERVER_NAMESPACE = '/appserver' as const;

export const RPC_NAMESPACES = {
  conversations: '/rpc/conversations',
  settings: '/rpc/settings',
  ui: '/rpc/ui',
  ipc: '/ipc',
  sidebar: '/sidebar_ipc',
  legacyAppserver: LEGACY_APPSERVER_NAMESPACE,
} as const;

export type RpcNamespaceName = keyof typeof RPC_NAMESPACES;

export const RPC_NAMESPACE_LAYOUT_STATUS = 'placeholder' as const;

export function getRpcNamespace(name: RpcNamespaceName): string {
  return RPC_NAMESPACES[name];
}
