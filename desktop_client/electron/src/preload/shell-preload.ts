import { contextBridge, ipcRenderer } from "electron";

import type {
  AppNavigation,
  DesktopBridge,
  DesktopSteerAction,
  NativeRequestMethod,
} from "../shared/contracts";
import { unwrapNativeRequestResult } from "../shared/native-request-contracts";

const bridge: DesktopBridge = {
  async request(method: NativeRequestMethod, params: Record<string, unknown> = {}) {
    const result = await ipcRenderer.invoke(
      "te2-desktop:native-request",
      method,
      params,
    );
    return unwrapNativeRequestResult(result);
  },
  onAppNavigation(callback: (navigation: AppNavigation) => void) {
    const listener = (_event: Electron.IpcRendererEvent, navigation: AppNavigation) => {
      callback(navigation);
    };
    ipcRenderer.on("te2-desktop:app-navigation", listener);
    return () => ipcRenderer.off("te2-desktop:app-navigation", listener);
  },
  onAssetUpdated(callback: (version: string | null) => void) {
    const listener = (_event: Electron.IpcRendererEvent, version: string | null) => {
      callback(version);
    };
    ipcRenderer.on("te2-desktop:asset-updated", listener);
    return () => ipcRenderer.off("te2-desktop:asset-updated", listener);
  },
  onSteer(callback: (action: DesktopSteerAction) => void) {
    const listener = (_event: Electron.IpcRendererEvent, action: DesktopSteerAction) => {
      callback(action);
    };
    ipcRenderer.on("te2-desktop:steer", listener);
    return () => ipcRenderer.off("te2-desktop:steer", listener);
  },
};

contextBridge.exposeInMainWorld("te2Desktop", bridge);
