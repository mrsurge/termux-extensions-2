import type { AssetStatus, AssetUpdateResult } from "./contracts";

export const ELECTRON_FRAMEWORK_PARTITION = "persist:te2-framework";
export const ELECTRON_CONSOLE_WORKER_LABEL = "electron:main_page";

export const ELECTRON_APP_VIEW_IDENTITY = Object.freeze({
  client: "electron",
  surface: "framework-app-view",
  consoleWorkerLabel: ELECTRON_CONSOLE_WORKER_LABEL,
} as const);

export const ELECTRON_APP_VIEW_COMMANDS = [
  "inspect",
  "reload",
  "home",
  "read_client_identity",
  "reset_client_identity",
  "wait_for_app_prerequisites",
  "force_asset_update",
  "register_run_target_surface",
  "release_run_target_surface",
  "read_sidebar_presentation_state",
  "write_sidebar_presentation_state",
  "open_sidebar_menu",
  "place_sidebar_surface",
  "detach_sidebar_surface",
  "focus_sidebar_surface",
  "refresh_sidebar_surface",
  "close_sidebar_surface",
  "reconcile_sidebar_surfaces",
  "open_second_editor",
  "sync_second_editor_project",
  "place_second_editor_surface",
  "set_second_editor_dock_size",
  "set_second_editor_mode",
  "second_editor_ready",
  "set_projection_probe_enabled",
  "inspect_projection_probe",
] as const;

export type ElectronAppViewCommand = typeof ELECTRON_APP_VIEW_COMMANDS[number];

export type ElectronAppViewInspection = {
  identity: typeof ELECTRON_APP_VIEW_IDENTITY;
  currentUrl: string;
  relayOrigin: string;
  configuredFrameworkOrigin: string;
  sessionPartition: typeof ELECTRON_FRAMEWORK_PARTITION;
  cacheSizeBytes: number;
  electronVersion: string;
  chromiumVersion: string;
  assets: AssetStatus;
  runTargets: Record<string, unknown>;
};

export type ElectronRunTargetRoute = {
  dto?: "RunTargetRoute";
  version?: 1;
  ticket: string;
  tunnelPath: string;
  preferredPort: number;
  originalUrl: string;
  expiresAt?: number;
  te2Runtime?: ElectronRunProfileRuntimeMetadata;
};

export type ElectronRunProfileRuntimeMetadata = {
  surfaceId: string;
  profileId: string;
  devRuntime: boolean;
  devTools: boolean;
  workerIdBase: string;
  workerLabel: string;
  frameworkOrigin: string;
};

export type ElectronRunTargetAuxiliaryRoute = ElectronRunTargetRoute & {
  label: string;
};

export type ElectronRunTargetRouteSet = {
  dto: "RunTargetRouteSet";
  version: 1;
  ownerId: string;
  shellId: string;
  relayGroupId: string;
  primary: ElectronRunTargetRoute;
  additional: ElectronRunTargetAuxiliaryRoute[];
  te2Runtime?: ElectronRunProfileRuntimeMetadata;
};

export type ElectronRunTargetDescriptor =
  | ElectronRunTargetRoute
  | ElectronRunTargetRouteSet;

export type ElectronSidebarPresentationMode =
  | "embedded"
  | "hidden"
  | "detached";

export type ElectronSidebarPresentationState = {
  version: 1;
  order: string[];
  foregroundHostId: string;
  lastAgentHostId: string;
  lastAgentPresentationId: string;
  presentations: Record<string, ElectronSidebarPresentationMode>;
};

export type ElectronEditorSurfaceMode =
  | "closed"
  | "docked"
  | "collapsed"
  | "detached";

export type ElectronEditorSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ElectronEditorSurfacePresentation = {
  mode: ElectronEditorSurfaceMode;
  dockSize: number;
  detachedBounds: ElectronEditorSurfaceBounds;
  maximized: boolean;
};

export type ElectronSecondEditorOpenRequest = {
  projectPath: string;
  path: string;
};

export type ElectronSecondEditorProjectRequest = {
  projectPath: string;
};

export type ElectronSecondEditorPlaceRequest = {
  bounds: ElectronEditorSurfaceBounds;
  visible: boolean;
};

export type ElectronSecondEditorCommand =
  | {
      type: "open";
      projectPath: string;
      path: string;
    }
  | {
      type: "state";
      projectPath: string;
      presentation: ElectronEditorSurfacePresentation;
    };

export const ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION = 2 as const;

export type ElectronSidebarSurfaceRenderer =
  | "url"
  | "persistent-extension";

export type ElectronSidebarSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ElectronSidebarSurfaceDescriptor = {
  version: typeof ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION;
  renderer: ElectronSidebarSurfaceRenderer;
  hostId: string;
  surfaceId: string;
  presentationId: string;
  label: string;
  url: string;
  windowName: string;
  appId: string;
  projectPath: string;
  profileId: string;
  shellId: string;
  devRuntime: boolean;
  devTools: boolean;
  consoleWorkerId: string;
};

export type ElectronSidebarSurfacePlaceRequest = {
  descriptor: ElectronSidebarSurfaceDescriptor;
  bounds: ElectronSidebarSurfaceBounds;
  visible: boolean;
};

export type ElectronSidebarMenuItem =
  | { type: "label"; label: string }
  | { type: "separator" }
  | { type: "item"; id: string; label: string; enabled: boolean };

export type ElectronSidebarMenuRequest = {
  x: number;
  y: number;
  items: ElectronSidebarMenuItem[];
};

export type ElectronSidebarSurfaceAction =
  | "attach"
  | "console"
  | "devtools"
  | "refresh"
  | "stop";

export type ElectronSidebarSurfaceEvent = {
  type: "closed" | "action";
  hostId: string;
  surfaceId: string;
  presentationId: string;
  action?: ElectronSidebarSurfaceAction;
};

export type ElectronSidebarSurfaceDetachRequest = {
  descriptor: ElectronSidebarSurfaceDescriptor;
  focus: boolean;
};

export type ElectronSidebarSurfaceReference = {
  surfaceId: string;
  presentationId?: string;
};

export type ElectronSidebarSurfaceReconcileRequest = {
  surfaceIds: string[];
};

export type ElectronDetachedSurfaceBridge = {
  ready(): void;
  action(action: ElectronSidebarSurfaceAction): void;
  onState(
    listener: (descriptor: ElectronSidebarSurfaceDescriptor) => void,
  ): () => void;
};

export type ElectronAppViewBridge = {
  readonly identity: typeof ELECTRON_APP_VIEW_IDENTITY;
  inspect(): Promise<ElectronAppViewInspection>;
  reload(): Promise<{ ok: true }>;
  home(): Promise<{ ok: true }>;
  readClientIdentity(): Promise<{ clientInstanceId: string }>;
  resetClientIdentity(): Promise<{ clientInstanceId: string }>;
  waitForAppPrerequisites(appId: string): Promise<{ ok: true }>;
  forceAssetUpdate(): Promise<AssetUpdateResult>;
  registerRunTargetSurface(
    runtime: ElectronRunProfileRuntimeMetadata,
    url: string,
    route?: ElectronRunTargetDescriptor,
  ): Promise<{ ok: true }>;
  releaseRunTargetSurface(surfaceId: string): Promise<{ ok: true }>;
  readSidebarPresentationState(
    projectPath: string,
  ): Promise<ElectronSidebarPresentationState>;
  writeSidebarPresentationState(
    projectPath: string,
    state: ElectronSidebarPresentationState,
  ): Promise<{ ok: true }>;
  openSidebarMenu(
    request: ElectronSidebarMenuRequest,
  ): Promise<{ selectedId: string | null }>;
  placeSidebarSurface(
    descriptor: ElectronSidebarSurfaceDescriptor,
    bounds: ElectronSidebarSurfaceBounds,
    visible: boolean,
  ): Promise<{ ok: true; presentationId: string }>;
  detachSidebarSurface(
    descriptor: ElectronSidebarSurfaceDescriptor,
    options?: { focus?: boolean },
  ): Promise<{ ok: true; presentationId: string }>;
  focusSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: boolean }>;
  refreshSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: boolean }>;
  closeSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: true }>;
  reconcileSidebarSurfaces(surfaceIds: string[]): Promise<{ ok: true }>;
  openSecondEditor(
    projectPath: string,
    path: string,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }>;
  syncSecondEditorProject(
    projectPath: string,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }>;
  placeSecondEditorSurface(
    bounds: ElectronEditorSurfaceBounds,
    visible: boolean,
  ): Promise<{ ok: true }>;
  setSecondEditorDockSize(
    dockSize: number,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }>;
  setSecondEditorMode(
    mode: ElectronEditorSurfaceMode,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }>;
  secondEditorReady(): Promise<{ ok: true }>;
  setProjectionProbeEnabled(
    enabled: boolean,
    clear?: boolean,
  ): Promise<unknown>;
  inspectProjectionProbe(): Promise<unknown>;
  onSecondEditorCommand(
    listener: (command: ElectronSecondEditorCommand) => void,
  ): () => void;
  onSidebarSurfaceEvent(
    listener: (event: ElectronSidebarSurfaceEvent) => void,
  ): () => void;
};

export function validateElectronAppViewCommand(value: unknown): ElectronAppViewCommand {
  if (
    typeof value === "string" &&
    (ELECTRON_APP_VIEW_COMMANDS as readonly string[]).includes(value)
  ) {
    return value as ElectronAppViewCommand;
  }
  throw new Error("Unsupported Electron app-view command");
}
