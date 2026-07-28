import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import {
  closedDialogResult,
  validateDialogRequest,
  validateDialogResult,
  type DialogRequest,
  type DialogOpenResponse,
  type DialogResult,
  type DialogResultStatus,
  type DialogSize,
} from "../shared/dialog-contracts";
import { installCloseOnBlur } from "./blur-close-policy";
import { installChromiumScrollbars } from "./chromium-scrollbars";
import { DESKTOP_MODAL_WINDOW_POLICY } from "./modal-window-policy";

type PendingDialog = {
  owner: WebContents;
  request: DialogRequest;
  presented: boolean;
  resolve: (result: DialogResult) => void;
  reject: (error: Error) => void;
};

type DialogHostOptions = {
  getMainWindow(): BrowserWindow | null;
  getAppContents(): WebContents | null;
  getRelayOrigin(): string;
  getAppPath(): string;
  shellUrl: string;
  installContextMenu(contents: WebContents): void;
};

const CLOSE_STATUSES = new Set<DialogResultStatus>([
  "cancelled",
  "closed",
  "replaced",
]);
const READY_TIMEOUT_MS = 10_000;
const INITIAL_DIALOG_SIZE: Record<DialogRequest["width"], DialogSize> = {
  small: { width: 500, height: 320 },
  medium: { width: 740, height: 560 },
  large: { width: 980, height: 720 },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedError(error: unknown): string {
  return errorMessage(error).replace(/\s+/g, " ").slice(0, 500);
}

function normalizedSize(value: unknown): DialogSize | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const width = Number((value as { width?: unknown }).width);
  const height = Number((value as { height?: unknown }).height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.max(320, Math.round(width)),
    height: Math.max(160, Math.round(height)),
  };
}

export class DesktopDialogHost {
  private readonly options: DialogHostOptions;
  private window: BrowserWindow | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, PendingDialog>();
  private registered = false;

  constructor(options: DialogHostOptions) {
    this.options = options;
  }

  registerIpc(): void {
    if (this.registered) return;
    this.registered = true;
    ipcMain.handle("te2-desktop:dialog-open", this.handleOpen);
    ipcMain.on("te2-desktop:dialog-close-all", this.handleOwnerCloseAll);
    ipcMain.on("te2-desktop:dialog-host-ready", this.handleHostReady);
    ipcMain.on("te2-desktop:dialog-presented", this.handlePresented);
    ipcMain.on("te2-desktop:dialog-resized", this.handleResized);
    ipcMain.on("te2-desktop:dialog-resolved", this.handleResolved);
    ipcMain.on("te2-desktop:dialog-failed", this.handleFailed);
  }

  dispose(): void {
    if (this.registered) {
      ipcMain.removeHandler("te2-desktop:dialog-open");
      ipcMain.off("te2-desktop:dialog-close-all", this.handleOwnerCloseAll);
      ipcMain.off("te2-desktop:dialog-host-ready", this.handleHostReady);
      ipcMain.off("te2-desktop:dialog-presented", this.handlePresented);
      ipcMain.off("te2-desktop:dialog-resized", this.handleResized);
      ipcMain.off("te2-desktop:dialog-resolved", this.handleResolved);
      ipcMain.off("te2-desktop:dialog-failed", this.handleFailed);
      this.registered = false;
    }
    this.destroy("closed");
  }

  closeForOwner(owner: WebContents | null, status: DialogResultStatus = "closed"): void {
    if (!owner) return;
    const affected = [...this.pending.entries()].filter(([, entry]) => entry.owner === owner);
    if (!affected.length) return;
    this.trySendHost("te2-desktop:dialog-host-close-all", { status });
    for (const [sessionId, entry] of affected) {
      this.pending.delete(sessionId);
      entry.resolve(closedDialogResult(status));
    }
    this.destroyWhenIdle();
  }

  closeAll(status: DialogResultStatus = "closed"): void {
    this.trySendHost("te2-desktop:dialog-host-close-all", { status });
    for (const entry of this.pending.values()) entry.resolve(closedDialogResult(status));
    this.pending.clear();
    this.destroyWhenIdle();
  }

  private readonly handleOpen = async (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<DialogOpenResponse> => {
    try {
      this.assertTrustedOwner(event.sender);
      const request = validateDialogRequest(value);
      await this.ensureWindow(request);

      const sessionId = randomUUID();
      const result = new Promise<DialogResult>((resolveResult, rejectResult) => {
        this.pending.set(sessionId, {
          owner: event.sender,
          request,
          presented: false,
          resolve: resolveResult,
          reject: rejectResult,
        });
      });
      try {
        this.sendHost("te2-desktop:dialog-present", { sessionId, request });
      } catch (error) {
        const entry = this.pending.get(sessionId);
        this.pending.delete(sessionId);
        entry?.reject(new Error(`Desktop dialog host unavailable: ${boundedError(error)}`));
      }
      return { ok: true, result: await result };
    } catch (error) {
      return {
        ok: false,
        error: `Desktop dialog was not presented: ${boundedError(error)}`,
      };
    }
  };

  private readonly handleOwnerCloseAll = (
    event: IpcMainEvent,
    rawStatus: unknown,
  ): void => {
    try {
      this.assertTrustedOwner(event.sender);
      const status = typeof rawStatus === "string" && CLOSE_STATUSES.has(rawStatus as DialogResultStatus)
        ? rawStatus as DialogResultStatus
        : "closed";
      this.closeForOwner(event.sender, status);
    } catch (error) {
      console.warn(`[te2-desktop-dialog] Rejected close request: ${boundedError(error)}`);
    }
  };

  private readonly handleHostReady = (event: IpcMainEvent): void => {
    if (!this.isCurrentHost(event.sender)) return;
    this.resolveReady();
  };

  private readonly handlePresented = (
    event: IpcMainEvent,
    sessionId: unknown,
    rawSize: unknown,
  ): void => {
    if (!this.isCurrentHost(event.sender) || typeof sessionId !== "string") return;
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    entry.presented = true;
    const size = normalizedSize(rawSize);
    if (size && this.topSessionId() === sessionId) this.fitWindow(size);
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
    }
  };

  private readonly handleResized = (
    event: IpcMainEvent,
    sessionId: unknown,
    rawSize: unknown,
  ): void => {
    if (
      !this.isCurrentHost(event.sender) ||
      typeof sessionId !== "string" ||
      this.topSessionId() !== sessionId
    ) return;
    const entry = this.pending.get(sessionId);
    const size = normalizedSize(rawSize);
    if (entry?.presented && size) this.fitWindow(size);
  };

  private readonly handleResolved = (
    event: IpcMainEvent,
    sessionId: unknown,
    rawResult: unknown,
  ): void => {
    if (!this.isCurrentHost(event.sender) || typeof sessionId !== "string") return;
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    try {
      const result = validateDialogResult(entry.request, rawResult);
      this.pending.delete(sessionId);
      entry.resolve(result);
    } catch (error) {
      this.failEntry(sessionId, entry, error);
      return;
    }
    this.destroyWhenIdle();
  };

  private readonly handleFailed = (
    event: IpcMainEvent,
    sessionId: unknown,
    message: unknown,
  ): void => {
    if (!this.isCurrentHost(event.sender) || typeof sessionId !== "string") return;
    const entry = this.pending.get(sessionId);
    if (!entry) return;
    this.failEntry(sessionId, entry, new Error(String(message || "Dialog renderer failed")));
  };

  private assertTrustedOwner(contents: WebContents): void {
    const current = this.options.getAppContents();
    if (!current || current.isDestroyed() || contents !== current) {
      throw new Error("Rejected dialog request from a stale renderer");
    }
    let origin = "";
    try {
      origin = new URL(contents.getURL()).origin;
    } catch {
      // The empty origin is rejected below.
    }
    if (origin !== this.options.getRelayOrigin()) {
      throw new Error("Rejected dialog request from an untrusted origin");
    }
  }

  private isCurrentHost(contents: WebContents): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && contents === this.window.webContents);
  }

  private async ensureWindow(request: DialogRequest): Promise<void> {
    if (this.window && !this.window.isDestroyed() && !this.readyPromise) return;
    if (this.readyPromise) return this.readyPromise;

    const parent = this.options.getMainWindow();
    if (!parent || parent.isDestroyed()) throw new Error("Desktop window is unavailable");
    const requestedSize = INITIAL_DIALOG_SIZE[request.width];
    const workArea = screen.getDisplayMatching(parent.getBounds()).workArea;
    const parentBounds = parent.getBounds();
    const width = Math.max(
      320,
      Math.min(requestedSize.width, Math.floor(workArea.width * 0.94), parentBounds.width - 48),
    );
    const height = Math.max(
      160,
      Math.min(requestedSize.height, Math.floor(workArea.height * 0.92), parentBounds.height - 48),
    );

    const window = new BrowserWindow({
      parent,
      ...DESKTOP_MODAL_WINDOW_POLICY,
      frame: false,
      show: false,
      width,
      height,
      minWidth: 320,
      minHeight: 160,
      backgroundColor: "#111315",
      autoHideMenuBar: true,
      skipTaskbar: true,
      useContentSize: true,
      webPreferences: {
        preload: resolve(this.options.getAppPath(), "dist", "dialog-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;
    window.setMenu(null);
    window.webContents.on("dom-ready", () => {
      void installChromiumScrollbars(window.webContents, "dialog");
    });
    this.options.installContextMenu(window.webContents);
    installCloseOnBlur(window, () => {
      if (this.window === window) this.closeAll("closed");
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("render-process-gone", (_event, details) => {
      this.hostFailed(new Error(`Dialog renderer exited: ${details.reason}`));
    });
    window.on("closed", () => {
      if (this.window === window) this.hostFailed(new Error("Dialog window closed"));
    });

    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      this.readyResolve = resolveReady;
      this.readyReject = rejectReady;
      this.readyTimer = setTimeout(() => {
        this.hostFailed(new Error("Dialog renderer did not become ready"));
      }, READY_TIMEOUT_MS);
    });
    void window.loadURL(this.options.shellUrl).catch((error) => this.hostFailed(error));
    return this.readyPromise;
  }

  private resolveReady(): void {
    if (!this.readyPromise) return;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    const resolveReady = this.readyResolve;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    resolveReady?.();
  }

  private hostFailed(error: unknown): void {
    const failure = new Error(`Desktop dialog host failed: ${boundedError(error)}`);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyReject?.(failure);
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;

    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
    for (const [sessionId, entry] of [...this.pending]) {
      this.failEntry(sessionId, entry, failure, false);
    }
  }

  private failEntry(
    sessionId: string,
    entry: PendingDialog,
    error: unknown,
    hide = true,
  ): void {
    this.pending.delete(sessionId);
    const message = boundedError(error);
    if (entry.presented) {
      console.warn(`[te2-desktop-dialog] Closing presented dialog after host failure: ${message}`);
      entry.resolve(closedDialogResult());
    } else {
      console.warn(`[te2-desktop-dialog] Falling back before presentation: ${message}`);
      entry.reject(new Error(`Desktop dialog was not presented: ${message}`));
    }
    if (hide) this.destroyWhenIdle();
  }

  private sendHost(channel: string, ...args: unknown[]): void {
    if (!this.window || this.window.isDestroyed()) throw new Error("Dialog window is unavailable");
    this.window.webContents.send(channel, ...args);
  }

  private trySendHost(channel: string, ...args: unknown[]): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(channel, ...args);
  }

  private topSessionId(): string | null {
    return [...this.pending.keys()].at(-1) || null;
  }

  private fitWindow(size: DialogSize): void {
    const window = this.window;
    const parent = this.options.getMainWindow();
    if (!window || window.isDestroyed() || !parent || parent.isDestroyed()) return;
    if (String(process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland") return;
    const workArea = screen.getDisplayMatching(parent.getBounds()).workArea;
    const parentBounds = parent.getBounds();
    const width = Math.max(
      320,
      Math.min(size.width, Math.floor(workArea.width * 0.94), parentBounds.width - 48),
    );
    const height = Math.max(
      160,
      Math.min(size.height, Math.floor(workArea.height * 0.92), parentBounds.height - 48),
    );
    const x = Math.max(
      workArea.x,
      Math.min(
        Math.round(parentBounds.x + (parentBounds.width - width) / 2),
        workArea.x + workArea.width - width,
      ),
    );
    const y = Math.max(
      workArea.y,
      Math.min(
        Math.round(parentBounds.y + (parentBounds.height - height) / 2),
        workArea.y + workArea.height - height,
      ),
    );
    window.setBounds({ x, y, width, height });
  }

  private destroyWhenIdle(): void {
    if (this.pending.size || !this.window || this.window.isDestroyed()) return;
    const window = this.window;
    this.window = null;
    window.destroy();
    this.options.getAppContents()?.focus();
  }

  private destroy(status: DialogResultStatus): void {
    this.closeAll(status);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readyReject?.(new Error("Desktop dialog host disposed"));
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
}
