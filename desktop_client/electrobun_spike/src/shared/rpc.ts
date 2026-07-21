import type { RPCSchema } from "electrobun";

import type { AssetStatus, AssetUpdateResult } from "../bun/assets";
import type { DesktopShellSettings } from "../bun/target";

export type FrameworkRequestParams = {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
};

export type DesktopConnectionSaveResult = {
  settings: DesktopShellSettings;
  browserFrameworkOrigin: string;
  connectionChanged: boolean;
};

export type DesktopShellRpc = {
  bun: RPCSchema<{
    requests: {
      getSettings: { params: {}; response: DesktopShellSettings };
      getBrowserFrameworkOrigin: { params: {}; response: { origin: string } };
      saveSettings: {
        params: Pick<DesktopShellSettings, "frameworkHost" | "frameworkPort">;
        response: DesktopConnectionSaveResult;
      };
      saveZoom: { params: { zoomLevel: number }; response: { zoomLevel: number } };
      frameworkRequest: { params: FrameworkRequestParams; response: unknown };
      getFrameworkStatus: {
        params: {};
        response: { online: boolean; frameworkBaseUrl: string; error?: string };
      };
      getFwsStatus: {
        params: {};
        response: { available: boolean; url: string; error?: string };
      };
      getAssetStatus: { params: {}; response: AssetStatus };
      updateAssets: { params: { force?: boolean }; response: AssetUpdateResult };
      getAssetRedirectRules: {
        params: {};
        response: { active: boolean; rules: string; version: string | null };
      };
      windowControl: {
        params: { action: "minimize" | "toggle-maximize" | "close" };
        response: { maximized?: boolean };
      };
      setWindowTitle: { params: { title: string }; response: {} };
    };
    messages: {
      reportDiagnostic: Record<string, unknown>;
    };
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      assetUpdated: { version: string | null };
    };
  }>;
};
