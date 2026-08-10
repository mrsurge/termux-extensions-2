export type DesktopShellSettings = {
  frameworkHost: string;
  frameworkPort: number;
  zoomLevel: number;
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
  request(method: NativeRequestMethod, params?: Record<string, unknown>): Promise<unknown>;
  onAppNavigation(callback: (navigation: AppNavigation) => void): () => void;
  onAssetUpdated(callback: (version: string | null) => void): () => void;
  onSteer(callback: (action: DesktopSteerAction) => void): () => void;
};
