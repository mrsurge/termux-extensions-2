import type {
  DesktopDialogPresenter,
  DialogHostBridge,
} from "./dialog-contracts";

declare global {
  interface Window {
    te2DesktopDialogs?: DesktopDialogPresenter;
    te2DesktopSurfaceWindows?: Readonly<{ enabled: boolean }>;
    te2DialogHost: DialogHostBridge;
  }
}

export {};
