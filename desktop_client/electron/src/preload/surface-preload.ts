import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  ElectronDetachedSurfaceBridge,
  ElectronSidebarSurfaceAction,
  ElectronSidebarSurfaceDescriptor,
} from "../shared/app-view-contracts";

const bridge: ElectronDetachedSurfaceBridge = Object.freeze({
  ready(): void {
    ipcRenderer.send("te2-desktop:sidebar-surface-ready");
  },
  action(action: ElectronSidebarSurfaceAction): void {
    ipcRenderer.send("te2-desktop:sidebar-surface-action", action);
  },
  onState(
    listener: (descriptor: ElectronSidebarSurfaceDescriptor) => void,
  ): () => void {
    const handler = (_event: IpcRendererEvent, value: unknown) => {
      if (value && typeof value === "object") {
        listener(value as ElectronSidebarSurfaceDescriptor);
      }
    };
    ipcRenderer.on("te2-desktop:sidebar-surface-state", handler);
    return () => ipcRenderer.off("te2-desktop:sidebar-surface-state", handler);
  },
});

contextBridge.exposeInMainWorld("te2DetachedSurface", bridge);
