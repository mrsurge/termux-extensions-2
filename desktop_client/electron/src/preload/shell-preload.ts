import { contextBridge, ipcRenderer } from "electron";

import type {
  AppNavigation,
  DesktopBridge,
  DesktopSteerAction,
  LocalFrameworkState,
  NativeRequestMethod,
} from "../shared/contracts";
import { unwrapNativeRequestResult } from "../shared/native-request-contracts";

const bridge: DesktopBridge = {
  notifyReady() {
    ipcRenderer.send("te2-desktop:shell-ready");
  },
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
  onLocalFrameworkState(callback: (state: LocalFrameworkState) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: LocalFrameworkState,
    ) => {
      callback(state);
    };
    ipcRenderer.on("te2-desktop:local-framework-state", listener);
    return () => ipcRenderer.off("te2-desktop:local-framework-state", listener);
  },
  onSteer(callback: (action: DesktopSteerAction) => void) {
    const listener = (_event: Electron.IpcRendererEvent, action: DesktopSteerAction) => {
      callback(action);
    };
    ipcRenderer.on("te2-desktop:steer", listener);
    return () => ipcRenderer.off("te2-desktop:steer", listener);
  },
  onStatus(callback: (message: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => {
      callback(message);
    };
    ipcRenderer.on("te2-desktop:status", listener);
    return () => ipcRenderer.off("te2-desktop:status", listener);
  },
};

contextBridge.exposeInMainWorld("te2Desktop", bridge);
