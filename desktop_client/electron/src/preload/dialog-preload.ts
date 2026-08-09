import { contextBridge, ipcRenderer } from "electron";

import type {
  DialogHostBridge,
  DialogHostCloseMessage,
  DialogHostOpenMessage,
  DialogResult,
  DialogSize,
} from "../shared/dialog-contracts";

const bridge: DialogHostBridge = {
  ready(): void {
    ipcRenderer.send("te2-desktop:dialog-host-ready");
  },
  presented(sessionId: string, size: DialogSize): void {
    ipcRenderer.send("te2-desktop:dialog-presented", sessionId, size);
  },
  resized(sessionId: string, size: DialogSize): void {
    ipcRenderer.send("te2-desktop:dialog-resized", sessionId, size);
  },
  resolved(sessionId: string, result: DialogResult): void {
    ipcRenderer.send("te2-desktop:dialog-resolved", sessionId, result);
  },
  failed(sessionId: string, message: string): void {
    ipcRenderer.send("te2-desktop:dialog-failed", sessionId, message);
  },
  onOpen(callback: (message: DialogHostOpenMessage) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, message: DialogHostOpenMessage) => {
      callback(message);
    };
    ipcRenderer.on("te2-desktop:dialog-present", listener);
    return () => ipcRenderer.off("te2-desktop:dialog-present", listener);
  },
  onCloseAll(callback: (message: DialogHostCloseMessage) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, message: DialogHostCloseMessage) => {
      callback(message);
    };
    ipcRenderer.on("te2-desktop:dialog-host-close-all", listener);
    return () => ipcRenderer.off("te2-desktop:dialog-host-close-all", listener);
  },
};

contextBridge.exposeInMainWorld("te2DialogHost", bridge);
