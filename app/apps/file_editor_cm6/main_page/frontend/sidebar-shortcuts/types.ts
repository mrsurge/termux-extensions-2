import type { UiIpcRpcMethod } from "../../../src/ui_ipc/rpc_contract.ts";

export type UnknownRecord = Record<string, unknown>;

export type ShortcutKind = "url" | "framework_app";
export type ShortcutLoad = "lazy" | "eager";
export type ShortcutIconKind = "asset" | "emoji" | "image" | "text" | "";

export interface ShortcutIcon extends UnknownRecord {
  kind?: ShortcutIconKind | string;
  name?: string;
  emoji?: string;
  src?: string;
  text?: string;
  value?: string;
  defaultIcon?: string;
}

export interface SidebarShortcut extends UnknownRecord {
  id: string;
  key: string;
  kind: ShortcutKind;
  app_id: string;
  label: string;
  url: string;
  version: string;
  icon: ShortcutIcon | null;
  load: ShortcutLoad;
  last_used: number;
  dock?: boolean;
  stateful?: boolean;
  state?: UnknownRecord;
  state_kind?: string;
  stateKind?: string;
  host_id?: string;
  base_url?: string;
  restore_url?: string;
  restoreUrl?: string;
  readiness?: SidebarWindowReadiness | null;
  dev_tools?: boolean;
  devTools?: boolean;
  devtools_target_id?: string;
  devToolsTargetId?: string;
  devtools_target_label?: string;
  devToolsTargetLabel?: string;
  run_target_route?: RunTargetDescriptor;
  runTargetRoute?: RunTargetDescriptor;
  run_profile_surface?: RunProfileSurfaceDescriptor;
  runProfileSurface?: RunProfileSurfaceDescriptor;
}

export interface RunProfileSurfaceDescriptor extends UnknownRecord {
  dto: "RunProfileSurface";
  version: 1;
  surfaceId: string;
  projectPath: string;
  profileId: string;
  runner: string;
  shellId: string;
  shellLabel: string;
  url: string;
  devRuntime: boolean;
  refreshRevision: number;
}

export interface RunProfileRuntimeMetadata extends UnknownRecord {
  surfaceId: string;
  profileId: string;
  devRuntime: boolean;
  devTools: boolean;
  workerIdBase: string;
  workerLabel: string;
  frameworkOrigin: string;
}

export interface RunTargetRouteDescriptor extends UnknownRecord {
  dto?: string;
  version?: number;
  ticket: string;
  tunnelPath: string;
  preferredPort: number;
  originalUrl: string;
  expiresAt?: number;
}

export interface RunTargetAuxiliaryRouteDescriptor extends RunTargetRouteDescriptor {
  label: string;
}

export interface RunTargetRouteSetDescriptor extends UnknownRecord {
  dto: "RunTargetRouteSet";
  version: 1;
  relayGroupId: string;
  primary: RunTargetRouteDescriptor;
  additional: RunTargetAuxiliaryRouteDescriptor[];
}

export type RunTargetDescriptor = RunTargetRouteDescriptor | RunTargetRouteSetDescriptor;

export interface SidebarShortcutPreference extends UnknownRecord {
  id?: string;
  kind?: ShortcutKind | string;
  app_id?: string;
  label?: string;
  url?: string;
  version?: string | number;
  icon?: ShortcutIcon | null;
  load?: ShortcutLoad | string;
  last_used?: number;
  state?: UnknownRecord;
  state_kind?: string;
  stateKind?: string;
}

export interface FrameworkAppManifest extends UnknownRecord {
  id?: string;
  title?: string;
  name?: string;
  icon_src?: string;
  icon_text?: string;
  icon_emoji?: string;
  asset_base_url?: string;
  base_url?: string;
  baseUrl?: string;
  launch_url?: string;
  embed_url?: string;
  stateful?: boolean;
  _dir?: string;
  sidebar_state?: UnknownRecord | null;
}

export interface SidebarWindowReadiness extends UnknownRecord {
  status?: string;
  phase?: string;
  message?: string;
  console_worker_id?: string;
  consoleWorkerId?: string;
  updated_at?: number;
  updatedAt?: number;
}

export interface SidebarAppDockSlot extends UnknownRecord {
  host_id?: string;
  hostId?: string;
  app_id?: string;
  appId?: string;
  base_url?: string;
  baseUrl?: string;
  stateful?: boolean;
  token_id?: string;
  tokenId?: string;
  console_worker_id?: string;
  consoleWorkerId?: string;
  console_worker_prefix?: string;
  consoleWorkerPrefix?: string;
  label?: string;
  title?: string;
  state_kind?: string;
  stateKind?: string;
  url?: string;
  restore_url?: string;
  restoreUrl?: string;
  query_state?: UnknownRecord;
  queryState?: UnknownRecord;
  load?: ShortcutLoad | string;
  icon?: ShortcutIcon | null;
  readiness?: SidebarWindowReadiness | null;
  dev_tools?: boolean;
  devTools?: boolean;
  devtools_target_id?: string;
  devToolsTargetId?: string;
  devtools_target_label?: string;
  devToolsTargetLabel?: string;
  run_target_route?: RunTargetDescriptor;
  runTargetRoute?: RunTargetDescriptor;
  run_profile_surface?: RunProfileSurfaceDescriptor;
  runProfileSurface?: RunProfileSurfaceDescriptor;
  updated_at?: number;
  updatedAt?: number;
  version?: string | number;
}

export type SidebarStatefulWindow = SidebarAppDockSlot;

export interface SidebarShortcutsHost {
  toast?: (message: string) => void;
}

export interface SidebarShortcutsOptions {
  host?: SidebarShortcutsHost | null;
  homeDir?: string;
  pickFile?: (startPath?: string) => Promise<string | null>;
  openDrawer?: () => void;
  closeAllMenus?: () => void;
  emitSidebarUiRequest?: (
    method: UiIpcRpcMethod,
    payload?: UnknownRecord,
  ) => void;
  setMenuChecked?: (el: HTMLElement | null, checked: boolean) => void;
}

export interface SidebarShortcutsRuntime {
  init: () => Promise<void>;
  hydrate: () => Promise<void> | void;
  applyUiPrefs: (uiPrefs: UnknownRecord) => void;
  getActiveUrl: (uiPrefs: UnknownRecord) => string;
}

export interface IframeEntry {
  iframe: HTMLIFrameElement;
  url: string;
  loaded: boolean;
  devToolsName: string;
  runProfileSurfaceId: string;
  version: string;
}

export interface JsonFetchResult<TBody = unknown> {
  resp: Response;
  body: TBody | null;
}

export interface ShellEventPayload extends UnknownRecord {
  app_id?: string;
  running?: boolean;
  catalog?: unknown[];
  running_ids?: unknown[];
  label?: string;
  spec_id?: string;
  status?: string;
}

export interface ShellEvent extends UnknownRecord {
  type?: string;
  app_id?: string;
  payload?: ShellEventPayload;
  data?: ShellEventPayload;
}
