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
  "force_asset_update",
  "register_run_target_surface",
  "release_run_target_surface",
  "read_sidebar_presentation_state",
  "write_sidebar_presentation_state",
  "detach_sidebar_surface",
  "focus_sidebar_surface",
  "close_sidebar_surface",
  "reconcile_sidebar_surfaces",
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

export const ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION = 1 as const;

export type ElectronSidebarSurfaceDescriptor = {
  version: typeof ELECTRON_SIDEBAR_SURFACE_DESCRIPTOR_VERSION;
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
  forceAssetUpdate(): Promise<AssetUpdateResult>;
  registerRunTargetSurface(
    runtime: ElectronRunProfileRuntimeMetadata,
    url: string,
    route?: ElectronRunTargetDescriptor,
  ): Promise<{ ok: true }>;
  releaseRunTargetSurface(surfaceId: string): Promise<{ ok: true }>;
  readSidebarPresentationState(): Promise<ElectronSidebarPresentationState>;
  writeSidebarPresentationState(
    state: ElectronSidebarPresentationState,
  ): Promise<{ ok: true }>;
  detachSidebarSurface(
    descriptor: ElectronSidebarSurfaceDescriptor,
    options?: { focus?: boolean },
  ): Promise<{ ok: true; presentationId: string }>;
  focusSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: boolean }>;
  closeSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: true }>;
  reconcileSidebarSurfaces(surfaceIds: string[]): Promise<{ ok: true }>;
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
