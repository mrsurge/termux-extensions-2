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
  "resolve_run_target",
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
};

export type ElectronRunTargetRoute = {
  dto?: "RunTargetRoute";
  version?: 1;
  ticket: string;
  tunnelPath: string;
  preferredPort: number;
  originalUrl: string;
  expiresAt?: number;
};

export type ElectronRunTargetAuxiliaryRoute = ElectronRunTargetRoute & {
  label: string;
};

export type ElectronRunTargetRouteSet = {
  dto: "RunTargetRouteSet";
  version: 1;
  relayGroupId: string;
  primary: ElectronRunTargetRoute;
  additional: ElectronRunTargetAuxiliaryRoute[];
};

export type ElectronRunTargetDescriptor =
  | ElectronRunTargetRoute
  | ElectronRunTargetRouteSet;

export type ElectronRunTargetResolution = {
  ok: true;
  mode: "direct" | "tunnel";
  url: string;
};

export type ElectronAppViewBridge = {
  readonly identity: typeof ELECTRON_APP_VIEW_IDENTITY;
  inspect(): Promise<ElectronAppViewInspection>;
  reload(): Promise<{ ok: true }>;
  home(): Promise<{ ok: true }>;
  forceAssetUpdate(): Promise<AssetUpdateResult>;
  resolveRunTarget(route: ElectronRunTargetDescriptor): Promise<ElectronRunTargetResolution>;
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
