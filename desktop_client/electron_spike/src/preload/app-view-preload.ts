import { contextBridge, ipcRenderer } from "electron";

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

contextBridge.exposeInMainWorld("te2DesktopDialogs", presenter);
contextBridge.exposeInMainWorld("te2DesktopSurfaceWindows", Object.freeze({
  enabled: true,
}));
