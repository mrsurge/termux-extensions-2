import { contextBridge, ipcRenderer } from "electron";

import {
  ELECTRON_APP_VIEW_IDENTITY,
  type ElectronAppViewBridge,
  type ElectronAppViewCommand,
  type ElectronAppViewInspection,
  type ElectronRunTargetDescriptor,
  type ElectronRunProfileRuntimeMetadata,
  type ElectronSidebarSurfaceBounds,
  type ElectronSidebarSurfaceDescriptor,
  type ElectronSidebarSurfaceEvent,
  type ElectronSidebarMenuRequest,
  type ElectronSidebarPresentationState,
  type ElectronEditorSurfaceBounds,
  type ElectronEditorSurfaceMode,
  type ElectronEditorSurfacePresentation,
  type ElectronSecondEditorCommand,
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
  readClientIdentity(): Promise<{ clientInstanceId: string }> {
    return invokeElectron("read_client_identity");
  },
  resetClientIdentity(): Promise<{ clientInstanceId: string }> {
    return invokeElectron("reset_client_identity");
  },
  waitForAppPrerequisites(appId: string): Promise<{ ok: true }> {
    return invokeElectron("wait_for_app_prerequisites", { appId });
  },
  forceAssetUpdate(): Promise<AssetUpdateResult> {
    return invokeElectron("force_asset_update");
  },
  registerRunTargetSurface(
    runtime: ElectronRunProfileRuntimeMetadata,
    url: string,
    route?: ElectronRunTargetDescriptor,
  ): Promise<{ ok: true }> {
    return invokeElectron("register_run_target_surface", { runtime, url, route });
  },
  releaseRunTargetSurface(surfaceId: string): Promise<{ ok: true }> {
    return invokeElectron("release_run_target_surface", surfaceId);
  },
  readSidebarPresentationState(): Promise<ElectronSidebarPresentationState> {
    return invokeElectron("read_sidebar_presentation_state");
  },
  writeSidebarPresentationState(
    state: ElectronSidebarPresentationState,
  ): Promise<{ ok: true }> {
    return invokeElectron("write_sidebar_presentation_state", state);
  },
  openSidebarMenu(
    request: ElectronSidebarMenuRequest,
  ): Promise<{ selectedId: string | null }> {
    return invokeElectron("open_sidebar_menu", request);
  },
  placeSidebarSurface(
    descriptor: ElectronSidebarSurfaceDescriptor,
    bounds: ElectronSidebarSurfaceBounds,
    visible: boolean,
  ): Promise<{ ok: true; presentationId: string }> {
    return invokeElectron("place_sidebar_surface", {
      descriptor,
      bounds,
      visible,
    });
  },
  detachSidebarSurface(
    descriptor: ElectronSidebarSurfaceDescriptor,
    options: { focus?: boolean } = {},
  ): Promise<{ ok: true; presentationId: string }> {
    return invokeElectron("detach_sidebar_surface", {
      descriptor,
      focus: options.focus !== false,
    });
  },
  focusSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: boolean }> {
    return invokeElectron("focus_sidebar_surface", {
      surfaceId,
      presentationId,
    });
  },
  refreshSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: boolean }> {
    return invokeElectron("refresh_sidebar_surface", {
      surfaceId,
      presentationId,
    });
  },
  closeSidebarSurface(
    surfaceId: string,
    presentationId?: string,
  ): Promise<{ ok: true }> {
    return invokeElectron("close_sidebar_surface", {
      surfaceId,
      presentationId,
    });
  },
  reconcileSidebarSurfaces(surfaceIds: string[]): Promise<{ ok: true }> {
    return invokeElectron("reconcile_sidebar_surfaces", { surfaceIds });
  },
  openSecondEditor(
    projectPath: string,
    path: string,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }> {
    return invokeElectron("open_second_editor", { projectPath, path });
  },
  syncSecondEditorProject(
    projectPath: string,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }> {
    return invokeElectron("sync_second_editor_project", { projectPath });
  },
  placeSecondEditorSurface(
    bounds: ElectronEditorSurfaceBounds,
    visible: boolean,
  ): Promise<{ ok: true }> {
    return invokeElectron("place_second_editor_surface", { bounds, visible });
  },
  setSecondEditorDockSize(
    dockSize: number,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }> {
    return invokeElectron("set_second_editor_dock_size", { dockSize });
  },
  setSecondEditorMode(
    mode: ElectronEditorSurfaceMode,
  ): Promise<{ ok: true; presentation: ElectronEditorSurfacePresentation }> {
    return invokeElectron("set_second_editor_mode", { mode });
  },
  secondEditorReady(): Promise<{ ok: true }> {
    return invokeElectron("second_editor_ready");
  },
  onSecondEditorCommand(
    listener: (command: ElectronSecondEditorCommand) => void,
  ): () => void {
    const channel = "te2-desktop:second-editor-command";
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (value && typeof value === "object") {
        listener(value as ElectronSecondEditorCommand);
      }
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  },
  onSidebarSurfaceEvent(
    listener: (event: ElectronSidebarSurfaceEvent) => void,
  ): () => void {
    const channel = "te2-desktop:sidebar-surface-event";
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (value && typeof value === "object") {
        listener(value as ElectronSidebarSurfaceEvent);
      }
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  },
});

contextBridge.exposeInMainWorld("te2DesktopDialogs", presenter);
contextBridge.exposeInMainWorld("te2DesktopSurfaceWindows", Object.freeze({
  enabled: true,
}));
contextBridge.exposeInMainWorld("te2Electron", electronBridge);
