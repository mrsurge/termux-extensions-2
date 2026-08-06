import type {
  DesktopDialogPresenter,
  DialogHostBridge,
} from "./dialog-contracts";
import type { ElectronAppViewBridge } from "./app-view-contracts";
import type { ElectronDetachedSurfaceBridge } from "./app-view-contracts";

declare global {
  interface Window {
    te2DesktopDialogs?: DesktopDialogPresenter;
    te2DesktopSurfaceWindows?: Readonly<{ enabled: boolean }>;
    te2Electron?: ElectronAppViewBridge;
    te2DetachedSurface?: ElectronDetachedSurfaceBridge;
    te2DialogHost: DialogHostBridge;
  }
}

export {};
