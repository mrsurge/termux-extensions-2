import { contextBridge, ipcRenderer } from "electron";

import {
  ELECTRON_APP_VIEW_IDENTITY,
  type ElectronAppViewBridge,
  type ElectronAppViewCommand,
  type ElectronAppViewInspection,
  type ElectronRunTargetResolution,
  type ElectronRunTargetDescriptor,
  type ElectronRunProfileRuntimeMetadata,
} from "../shared/app-view-contracts";
import type { AssetUpdateResult } from "../shared/contracts";

import type {
  DesktopDialogPresenter,
  DialogOpenResponse,
  DialogRequest,
  DialogResult,
  DialogResultStatus,
} from "../shared/dialog-contracts";

const presenter: DesktopDialogPresenter = {
  async open(request: DialogRequest): Promise<DialogResult> {
    const response = await ipcRenderer.invoke(
      "te2-desktop:dialog-open",
      request,
    ) as DialogOpenResponse;
    if (!response || response.ok !== true) {
      throw new Error(
        response && typeof response.error === "string"
          ? response.error
          : "Desktop dialog host returned an invalid response",
      );
    }
    return response.result;
  },
  closeAll(status: DialogResultStatus = "closed"): void {
    ipcRenderer.send("te2-desktop:dialog-close-all", status);
  },
};

function invokeElectron<T>(command: ElectronAppViewCommand, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(
    "te2-desktop:app-view-control",
    command,
    payload,
  ) as Promise<T>;
}

const electronBridge: ElectronAppViewBridge = Object.freeze({
  identity: ELECTRON_APP_VIEW_IDENTITY,
  inspect(): Promise<ElectronAppViewInspection> {
    return invokeElectron("inspect");
  },
  reload(): Promise<{ ok: true }> {
    return invokeElectron("reload");
  },
  home(): Promise<{ ok: true }> {
    return invokeElectron("home");
  },
  forceAssetUpdate(): Promise<AssetUpdateResult> {
    return invokeElectron("force_asset_update");
  },
  resolveRunTarget(route: ElectronRunTargetDescriptor): Promise<ElectronRunTargetResolution> {
    return invokeElectron("resolve_run_target", route);
  },
  registerRunTargetSurface(
    runtime: ElectronRunProfileRuntimeMetadata,
    url: string,
  ): Promise<{ ok: true }> {
    return invokeElectron("register_run_target_surface", { runtime, url });
  },
  releaseRunTargetSurface(surfaceId: string): Promise<{ ok: true }> {
    return invokeElectron("release_run_target_surface", surfaceId);
  },
});

contextBridge.exposeInMainWorld("te2DesktopDialogs", presenter);
contextBridge.exposeInMainWorld("te2DesktopSurfaceWindows", Object.freeze({
  enabled: true,
}));
contextBridge.exposeInMainWorld("te2Electron", electronBridge);
