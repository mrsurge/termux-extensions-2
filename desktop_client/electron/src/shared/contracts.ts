export const DESKTOP_SETTINGS_VERSION = 2;
export const LOCAL_FRAMEWORK_CONFIG_VERSION = 1;

export type DesktopFrameworkBookmark = {
  name: string;
  frameworkHost: string;
  frameworkPort: number;
};

export type DesktopFrameworkBookmarkView = DesktopFrameworkBookmark & {
  frameworkBaseUrl: string;
};

export type DesktopShellSettings = {
  version: typeof DESKTOP_SETTINGS_VERSION;
  frameworkHost: string;
  frameworkPort: number;
  frameworkBookmarks: DesktopFrameworkBookmark[];
  zoomLevel: number;
  autostart: boolean;
  preferredAppId: string;
};

export type LocalFrameworkCommandSource =
  | "override"
  | "configured"
  | "detected"
  | "none";

export type LocalFrameworkConfig = {
  version: typeof LOCAL_FRAMEWORK_CONFIG_VERSION;
  command: string;
  venvPath: string;
  broadcast: string[];
  port: number;
  env: Record<string, string>;
};

export type LocalFrameworkConfigView = LocalFrameworkConfig & {
  persisted: boolean;
  path: string;
  resolvedCommand: string;
  commandSource: LocalFrameworkCommandSource;
  commandDetected: boolean;
  venv: boolean;
  error: string | null;
};

export type LocalFrameworkPhase =
  | "unavailable"
  | "idle"
  | "probing"
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed";

export type LocalFrameworkOwnership = "none" | "external" | "electron";

export type LocalFrameworkState = {
  supported: boolean;
  phase: LocalFrameworkPhase;
  ownership: LocalFrameworkOwnership;
  localOrigin: string;
  selected: boolean;
  processId: number | null;
  command: string;
  commandSource: LocalFrameworkCommandSource;
  commandDetected: boolean;
  venv: boolean;
  venvPath: string;
  broadcast: string[];
  error: string | null;
};

export const MIN_ZOOM_LEVEL = 0.5;
export const MAX_ZOOM_LEVEL = 2;

export type AssetStatus = {
  assetRoot: string;
  localVersion: string | null;
  valid: boolean;
  missingRequiredAsset: string | null;
  serverBaseUrl: string | null;
  interceptorAvailable: boolean;
  interceptorError: string | null;
};

export type AssetUpdateResult = AssetStatus & {
  ok: boolean;
  updated: boolean;
  serverVersion: string | null;
  error: string | null;
};

export type NativeRequestMethod =
  | "get_settings"
  | "get_browser_framework_origin"
  | "save_settings"
  | "get_framework_bookmarks"
  | "upsert_framework_bookmark"
  | "delete_framework_bookmark"
  | "get_local_framework_config"
  | "save_local_framework_config"
  | "get_local_framework_state"
  | "start_local_framework"
  | "stop_local_framework"
  | "use_local_framework"
  | "framework_request"
  | "get_framework_status"
  | "get_fws_status"
  | "get_asset_status"
  | "update_assets"
  | "navigate_app"
  | "view_action"
  | "window_control"
  | "set_window_title";

export type AppNavigation = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type DesktopSteerAction = "home";

export type DesktopBridge = {
  notifyReady(): void;
  request(method: NativeRequestMethod, params?: Record<string, unknown>): Promise<unknown>;
  onAppNavigation(callback: (navigation: AppNavigation) => void): () => void;
  onAssetUpdated(callback: (version: string | null) => void): () => void;
  onLocalFrameworkState(callback: (state: LocalFrameworkState) => void): () => void;
  onSteer(callback: (action: DesktopSteerAction) => void): () => void;
  onStatus(callback: (message: string) => void): () => void;
};
