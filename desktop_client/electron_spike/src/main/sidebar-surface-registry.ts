import { resolve } from "node:path";

import {
  BrowserWindow,
  WebContentsView,
  webFrameMain,
  type WebContents,
} from "electron";

import type {
  ElectronSidebarSurfaceAction,
  ElectronSidebarSurfaceDescriptor,
  ElectronSidebarSurfaceEvent,
} from "../shared/app-view-contracts";

const SURFACE_HEADER_HEIGHT = 42;

interface DetachedSurfaceEntry {
  descriptor: ElectronSidebarSurfaceDescriptor;
  window: BrowserWindow;
  view: WebContentsView;
  notifyOnClose: boolean;
}

export interface DetachedSidebarSurfaceRegistryOptions {
  getAppPath(): string;
  getAppContents(): WebContents | null;
  getRelayOrigin(): string;
  shellUrl: string;
  frameworkPartition: string;
  registerTrustedContents(contents: WebContents): void;
  unregisterTrustedContents(contents: WebContents): void;
  installContextMenu(contents: WebContents, owner: BrowserWindow): void;
  installScrollbars(contents: WebContents): Promise<void>;
  injectRunProfileFrame(frame: Electron.WebFrameMain): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function frameBounds(window: BrowserWindow): Electron.Rectangle {
  const [width, height] = window.getContentSize();
  return {
    x: 0,
    y: SURFACE_HEADER_HEIGHT,
    width,
    height: Math.max(0, height - SURFACE_HEADER_HEIGHT),
  };
}

export class DetachedSidebarSurfaceRegistry {
  readonly #entries = new Map<string, DetachedSurfaceEntry>();
  readonly #options: DetachedSidebarSurfaceRegistryOptions;

  constructor(options: DetachedSidebarSurfaceRegistryOptions) {
    this.#options = options;
  }

  async detach(
    descriptor: ElectronSidebarSurfaceDescriptor,
    focus = true,
  ): Promise<{ ok: true; presentationId: string }> {
    const current = this.#entries.get(descriptor.surfaceId);
    if (
      current &&
      current.descriptor.presentationId === descriptor.presentationId &&
      !current.window.isDestroyed()
    ) {
      current.descriptor = descriptor;
      this.#sendState(current);
      if (focus) this.#focusEntry(current);
      return { ok: true, presentationId: descriptor.presentationId };
    }
    if (current) this.#closeEntry(current, false);

    const window = new BrowserWindow({
      title: descriptor.label,
      width: 980,
      height: 720,
      minWidth: 440,
      minHeight: 300,
      frame: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#111315",
      webPreferences: {
        preload: resolve(
          this.#options.getAppPath(),
          "dist",
          "surface-preload.cjs",
        ),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setMenu(null);

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.#options.frameworkPartition,
      },
    });
    view.setBackgroundColor("#111315");
    window.contentView.addChildView(view);
    view.setBounds(frameBounds(window));

    const entry: DetachedSurfaceEntry = {
      descriptor,
      window,
      view,
      notifyOnClose: true,
    };
    this.#entries.set(descriptor.surfaceId, entry);
    this.#options.registerTrustedContents(view.webContents);
    this.#options.installContextMenu(view.webContents, window);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("dom-ready", () => {
      void this.#options.installScrollbars(view.webContents).catch((error) => {
        console.warn(
          `[te2-desktop] Detached surface scrollbar install failed: ${errorMessage(error)}`,
        );
      });
    });
    view.webContents.on(
      "did-frame-finish-load",
      (_event, _isMainFrame, processId, routingId) => {
        const frame = webFrameMain.fromId(processId, routingId);
        if (!frame || frame.isDestroyed()) return;
        void this.#options.injectRunProfileFrame(frame).catch((error) => {
          console.warn(
            `[te2-desktop] Detached Run Profile injection failed: ${errorMessage(error)}`,
          );
        });
      },
    );
    view.webContents.on("did-fail-load", (_event, code, description, url) => {
      if (code !== -3) {
        console.error(
          `[te2-desktop] Detached surface load failed ${code} ${description}: ${url}`,
        );
      }
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      console.error(
        `[te2-desktop] Detached surface renderer exited: ${details.reason}`,
      );
      this.#closeEntry(entry, true);
    });

    window.on("resize", () => {
      if (!view.webContents.isDestroyed()) view.setBounds(frameBounds(window));
    });
    window.on("closed", () => this.#finishClosedEntry(entry));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("did-finish-load", () => this.#sendState(entry));

    try {
      await window.loadURL(this.#options.shellUrl);
      this.#sendState(entry);
      await view.webContents.loadURL("about:blank");
      if (descriptor.windowName) {
        await view.webContents.executeJavaScript(
          `window.name = ${JSON.stringify(descriptor.windowName)}`,
          true,
        );
      }
      await view.webContents.loadURL(descriptor.url);
      if (this.#entries.get(descriptor.surfaceId) !== entry) {
        throw new Error("Detached Sidebar surface was replaced during navigation");
      }
      window.show();
      if (focus) this.#focusEntry(entry);
      return { ok: true, presentationId: descriptor.presentationId };
    } catch (error) {
      this.#closeEntry(entry, false);
      throw error;
    }
  }

  focus(surfaceId: string, presentationId?: string): boolean {
    const entry = this.#matchingEntry(surfaceId, presentationId);
    if (!entry) return false;
    this.#focusEntry(entry);
    return true;
  }

  close(surfaceId: string, presentationId?: string, notify = true): void {
    const entry = this.#matchingEntry(surfaceId, presentationId);
    if (entry) this.#closeEntry(entry, notify);
  }

  reconcile(surfaceIds: readonly string[]): void {
    const desired = new Set(surfaceIds);
    for (const [surfaceId, entry] of this.#entries) {
      if (!desired.has(surfaceId)) this.#closeEntry(entry, false);
    }
  }

  closeAll(notify = false): void {
    for (const entry of [...this.#entries.values()]) {
      this.#closeEntry(entry, notify);
    }
  }

  handleShellReady(contents: WebContents): boolean {
    const entry = this.#entryForShellContents(contents);
    if (!entry) return false;
    this.#sendState(entry);
    return true;
  }

  handleShellAction(
    contents: WebContents,
    action: ElectronSidebarSurfaceAction,
  ): boolean {
    const entry = this.#entryForShellContents(contents);
    if (!entry) return false;
    if (action === "attach") {
      this.#closeEntry(entry, true);
      return true;
    }
    if (action === "refresh") {
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.reloadIgnoringCache();
      }
      return true;
    }
    if (action === "devtools") {
      if (!entry.view.webContents.isDestroyed()) {
        entry.view.webContents.openDevTools({ mode: "detach" });
      }
      return true;
    }
    this.#emitToApp({
      type: "action",
      hostId: entry.descriptor.hostId,
      surfaceId: entry.descriptor.surfaceId,
      presentationId: entry.descriptor.presentationId,
      action,
    });
    return true;
  }

  #matchingEntry(
    surfaceId: string,
    presentationId?: string,
  ): DetachedSurfaceEntry | null {
    const entry = this.#entries.get(surfaceId) || null;
    if (
      !entry ||
      (presentationId && entry.descriptor.presentationId !== presentationId)
    ) {
      return null;
    }
    return entry;
  }

  #entryForShellContents(contents: WebContents): DetachedSurfaceEntry | null {
    for (const entry of this.#entries.values()) {
      if (entry.window.webContents === contents) return entry;
    }
    return null;
  }

  #focusEntry(entry: DetachedSurfaceEntry): void {
    if (entry.window.isDestroyed()) return;
    if (entry.window.isMinimized()) entry.window.restore();
    entry.window.show();
    entry.window.focus();
  }

  #sendState(entry: DetachedSurfaceEntry): void {
    const contents = entry.window.webContents;
    if (!contents.isDestroyed()) {
      contents.send("te2-desktop:sidebar-surface-state", entry.descriptor);
    }
  }

  #closeEntry(entry: DetachedSurfaceEntry, notify: boolean): void {
    entry.notifyOnClose = notify;
    if (!entry.window.isDestroyed()) {
      entry.window.close();
    } else {
      this.#finishClosedEntry(entry);
    }
  }

  #finishClosedEntry(entry: DetachedSurfaceEntry): void {
    const isCurrent = this.#entries.get(entry.descriptor.surfaceId) === entry;
    if (isCurrent) this.#entries.delete(entry.descriptor.surfaceId);
    this.#options.unregisterTrustedContents(entry.view.webContents);
    if (!entry.view.webContents.isDestroyed()) {
      try {
        entry.window.contentView.removeChildView(entry.view);
      } catch {
        // The owning BrowserWindow may already be destroyed.
      }
      entry.view.webContents.close();
    }
    if (isCurrent && entry.notifyOnClose) {
      this.#emitToApp({
        type: "closed",
        hostId: entry.descriptor.hostId,
        surfaceId: entry.descriptor.surfaceId,
        presentationId: entry.descriptor.presentationId,
      });
    }
  }

  #emitToApp(event: ElectronSidebarSurfaceEvent): void {
    const contents = this.#options.getAppContents();
    if (!contents || contents.isDestroyed()) return;
    let origin = "";
    try {
      origin = new URL(contents.getURL()).origin;
    } catch {
      return;
    }
    if (origin !== this.#options.getRelayOrigin()) return;
    contents.send("te2-desktop:sidebar-surface-event", event);
  }
}
