import { RPC_NAMESPACES } from '../rpc/namespaces.ts';
import type { JsonObject, JsonRpcNotificationEnvelope } from '../rpc/transport.ts';

export const SIDEBAR_IPC_RPC_NAMESPACE = RPC_NAMESPACES.sidebarIpc;

export const SIDEBAR_IPC_RPC_METHODS = {
  register: 'sidebar.register',
  cwdGet: 'sidebar.cwd.get',
  cwdSync: 'sidebar.cwd.sync',
  fileOpen: 'sidebar.file.open',
  fileEdit: 'sidebar.file.edit',
  mention: 'sidebar.mention',
  projectLookup: 'sidebar.project.lookup',
  projectOpen: 'sidebar.project.open',
  projectCreate: 'sidebar.project.create',
  launcherCatalogGet: 'sidebar.launcher.catalog.get',
  windowsList: 'sidebar.windows.list',
  windowCreate: 'sidebar.window.create',
  windowOpenUrl: 'sidebar.window.openUrl',
  windowStateUpdate: 'sidebar.window.state.update',
  windowActivate: 'sidebar.window.activate',
  windowClose: 'sidebar.window.close',
  windowReadinessUpdate: 'sidebar.window.readiness.update',
  activeShortcutSet: 'sidebar.activeShortcut.set',
  activeShortcutRefresh: 'sidebar.activeShortcut.refresh',
  drawerOpen: 'sidebar.drawer.open',
  drawerClose: 'sidebar.drawer.close',
  drawerToggle: 'sidebar.drawer.toggle',
} as const;

export const SIDEBAR_IPC_RPC_NOTIFICATIONS = {
  presence: 'sidebar.presence',
  cwdSet: 'sidebar.cwd.set',
  clientState: 'sidebar.clientState',
  mention: 'sidebar.mention',
  fileOpen: 'sidebar.file.open',
  projectOpened: 'sidebar.project.opened',
  windowsChanged: 'sidebar.windows.changed',
  windowActivated: 'sidebar.window.activated',
  windowReadinessChanged: 'sidebar.window.readiness.changed',
  activeShortcutRefresh: 'sidebar.activeShortcut.refresh',
  drawerState: 'sidebar.drawer.state',
  drawerOpen: 'sidebar.drawer.open',
  drawerClose: 'sidebar.drawer.close',
  drawerToggle: 'sidebar.drawer.toggle',
} as const;

type ValueOf<T> = T[keyof T];

export type SidebarIpcRpcMethod = ValueOf<typeof SIDEBAR_IPC_RPC_METHODS>;
export type SidebarIpcRpcNotificationMethod = ValueOf<typeof SIDEBAR_IPC_RPC_NOTIFICATIONS>;

export interface SidebarIpcRpcNotification {
  method: SidebarIpcRpcNotificationMethod;
  params: JsonObject;
}

const SIDEBAR_IPC_RPC_NOTIFICATION_METHOD_SET = new Set<string>(
  Object.values(SIDEBAR_IPC_RPC_NOTIFICATIONS),
);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeSidebarIpcRpcParams(payload: unknown): JsonObject {
  return isJsonObject(payload) ? payload : {};
}

export function isSidebarIpcRpcNotificationMethod(
  method: string,
): method is SidebarIpcRpcNotificationMethod {
  return SIDEBAR_IPC_RPC_NOTIFICATION_METHOD_SET.has(method);
}

export function parseSidebarIpcRpcNotification(
  notification: JsonRpcNotificationEnvelope | JsonObject,
): SidebarIpcRpcNotification | null {
  const method = typeof notification.method === 'string' ? notification.method : '';
  if (!isSidebarIpcRpcNotificationMethod(method)) return null;
  return {
    method,
    params: normalizeSidebarIpcRpcParams(notification.params),
  };
}

export function buildSidebarIpcRpcNotificationEnvelope(
  method: SidebarIpcRpcNotificationMethod,
  params: JsonObject = {},
): JsonObject {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}
