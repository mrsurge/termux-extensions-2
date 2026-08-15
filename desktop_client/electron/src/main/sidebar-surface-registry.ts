import { resolve } from "node:path";

import {
  BrowserWindow,
  WebContentsView,
  webFrameMain,
  type WebContents,
} from "electron";

import type {
  ElectronSidebarSurfaceAction,
  ElectronSidebarSurfaceBounds,
  ElectronSidebarSurfaceDescriptor,
  ElectronSidebarSurfaceEvent,
} from "../shared/app-view-contracts";

const SURFACE_HEADER_HEIGHT = 42;

type SurfaceParent = "none" | "main" | "detached";

interface SidebarSurfaceEntry {
  descriptor: ElectronSidebarSurfaceDescriptor;
  view: WebContentsView;
  persistent: boolean;
  parent: SurfaceParent;
  window: BrowserWindow | null;
  embeddedBounds: ElectronSidebarSurfaceBounds;
  embeddedVisible: boolean;
  notifyOnClose: boolean;
  disposing: boolean;
  loadPromise: Promise<void> | null;
}

export interface DetachedSidebarSurfaceRegistryOptions {
  getAppPath(): string;
  getAppContents(): WebContents | null;
  getMainWindow(): BrowserWindow | null;
  getAppViewBounds(): Electron.Rectangle;
  getAppZoomFactor(): number;
  getRelayOrigin(): string;
  shellUrl: string;
  frameworkPartition: string;
  registerTrustedContents(contents: WebContents): void;
  unregisterTrustedContents(contents: WebContents): void;
  installContextMenu(
    contents: WebContents,
    owner: () => BrowserWindow | null,
  ): void;
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

function emptyBounds(): ElectronSidebarSurfaceBounds {
  return { x: 0, y: 0, width: 0, height: 0 };
}

export class DetachedSidebarSurfaceRegistry {
  readonly #entries = new Map<string, SidebarSurfaceEntry>();
  readonly #options: DetachedSidebarSurfaceRegistryOptions;

  constructor(options: DetachedSidebarSurfaceRegistryOptions) {
    this.#options = options;
  }

  async place(
    descriptor: ElectronSidebarSurfaceDescriptor,
    bounds: ElectronSidebarSurfaceBounds,
    visible: boolean,
  ): Promise<{ ok: true; presentationId: string }> {
    if (descriptor.renderer !== "persistent-extension") {
      throw new Error("Embedded placement requires a persistent extension renderer");
    }
    let entry = this.#entries.get(descriptor.surfaceId) || null;
    if (
      entry &&
      (!entry.persistent ||
        entry.descriptor.presentationId !== descriptor.presentationId ||
        entry.descriptor.url !== descriptor.url)
    ) {
      this.#disposeEntry(entry);
      entry = null;
    }
    if (!entry) {
      entry = this.#createEntry(descriptor, true);
      this.#entries.set(descriptor.surfaceId, entry);
      entry.loadPromise = this.#loadEntry(entry);
    } else {
      entry.descriptor = descriptor;
    }
    entry.embeddedBounds = { ...bounds };
    entry.embeddedVisible = visible;
    if (!entry.window) this.#attachToMain(entry, false);
    this.#layoutEntry(entry);
    await entry.loadPromise;
    entry.loadPromise = null;
    if (this.#entries.get(descriptor.surfaceId) !== entry) {
      throw new Error("Persistent extension surface was replaced during placement");
    }
    if (!entry.window) this.#layoutEntry(entry);
    return { ok: true, presentationId: descriptor.presentationId };
  }

  async detach(
    descriptor: ElectronSidebarSurfaceDescriptor,
    focus = true,
  ): Promise<{ ok: true; presentationId: string }> {
    if (descriptor.renderer === "persistent-extension") {
      const entry = this.#entries.get(descriptor.surfaceId) || null;
      if (
        !entry ||
        !entry.persistent ||
        entry.descriptor.presentationId !== descriptor.presentationId
      ) {
        throw new Error(
          "Persistent extension surface must be embedded before it can detach",
        );
      }
      entry.descriptor = descriptor;
      await entry.loadPromise;
      entry.loadPromise = null;
      await this.#detachEntry(entry, focus);
      return { ok: true, presentationId: descriptor.presentationId };
    }

    const current = this.#entries.get(descriptor.surfaceId) || null;
    if (
      current &&
      current.descriptor.presentationId === descriptor.presentationId &&
      current.window &&
      !current.window.isDestroyed()
    ) {
      current.descriptor = descriptor;
      this.#sendState(current);
      if (focus) this.#focusEntry(current);
      return { ok: true, presentationId: descriptor.presentationId };
    }
    if (current) this.#disposeEntry(current);

    const entry = this.#createEntry(descriptor, false);
    this.#entries.set(descriptor.surfaceId, entry);
    entry.loadPromise = this.#loadEntry(entry);
    await entry.loadPromise;
    entry.loadPromise = null;
    await this.#detachEntry(entry, focus);
    return { ok: true, presentationId: descriptor.presentationId };
  }

  layoutEmbedded(): void {
    for (const entry of this.#entries.values()) this.#layoutEntry(entry);
  }

  suspendEmbedded(): void {
    for (const entry of this.#entries.values()) {
      if (!entry.persistent || entry.parent !== "main") continue;
      entry.embeddedVisible = false;
      if (!entry.view.webContents.isDestroyed()) entry.view.setVisible(false);
    }
  }

  focus(surfaceId: string, presentationId?: string): boolean {
    const entry = this.#matchingEntry(surfaceId, presentationId);
    if (!entry?.window) return false;
    this.#focusEntry(entry);
    return true;
  }

  refresh(surfaceId: string, presentationId?: string): boolean {
    const entry = this.#matchingEntry(surfaceId, presentationId);
    if (!entry || entry.view.webContents.isDestroyed()) return false;
    entry.view.webContents.reloadIgnoringCache();
    return true;
  }

  close(surfaceId: string, presentationId?: string, notify = true): void {
    const entry = this.#matchingEntry(surfaceId, presentationId);
    if (!entry) return;
    if (entry.persistent) {
      entry.notifyOnClose = notify;
      this.#attachToMain(entry, false);
      const window = entry.window;
      entry.window = null;
      if (window && !window.isDestroyed()) window.close();
      if (!window && notify) this.#emitClosed(entry);
      return;
    }
    this.#closeAndDispose(entry, notify);
  }

  reconcile(surfaceIds: readonly string[]): void {
    const desired = new Set(surfaceIds);
    for (const [surfaceId, entry] of this.#entries) {
      if (!desired.has(surfaceId)) this.#disposeEntry(entry);
    }
  }

  closeAll(notify = false): void {
    for (const entry of [...this.#entries.values()]) {
      if (notify) this.#emitClosed(entry);
      this.#disposeEntry(entry);
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
      this.close(
        entry.descriptor.surfaceId,
        entry.descriptor.presentationId,
        true,
      );
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

  #createEntry(
    descriptor: ElectronSidebarSurfaceDescriptor,
    persistent: boolean,
  ): SidebarSurfaceEntry {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.#options.frameworkPartition,
      },
    });
    view.setBackgroundColor("#111315");
    view.setVisible(false);
    const entry: SidebarSurfaceEntry = {
      descriptor,
      view,
      persistent,
      parent: "none",
      window: null,
      embeddedBounds: emptyBounds(),
      embeddedVisible: false,
      notifyOnClose: true,
      disposing: false,
      loadPromise: null,
    };
    this.#options.registerTrustedContents(view.webContents);
    this.#options.installContextMenu(
      view.webContents,
      () => entry.window || this.#options.getMainWindow(),
    );
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("dom-ready", () => {
      void this.#options.installScrollbars(view.webContents).catch((error) => {
        console.warn(
          `[te2-desktop] Sidebar surface scrollbar install failed: ${errorMessage(error)}`,
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
            `[te2-desktop] Sidebar Run Profile injection failed: ${errorMessage(error)}`,
          );
        });
      },
    );
    view.webContents.on("did-fail-load", (_event, code, description, url) => {
      if (code !== -3) {
        console.error(
          `[te2-desktop] Sidebar surface load failed ${code} ${description}: ${url}`,
        );
      }
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      if (entry.disposing) return;
      console.error(
        `[te2-desktop] Sidebar surface renderer exited: ${details.reason}`,
      );
      this.#disposeEntry(entry);
      this.#emitClosed(entry);
    });
    return entry;
  }

  async #loadEntry(entry: SidebarSurfaceEntry): Promise<void> {
    try {
      await entry.view.webContents.loadURL("about:blank");
      if (entry.descriptor.windowName) {
        await entry.view.webContents.executeJavaScript(
          `window.name = ${JSON.stringify(entry.descriptor.windowName)}`,
          true,
        );
      }
      await entry.view.webContents.loadURL(entry.descriptor.url);
      if (this.#entries.get(entry.descriptor.surfaceId) !== entry) {
        throw new Error("Sidebar surface was replaced during navigation");
      }
    } catch (error) {
      this.#disposeEntry(entry);
      throw error;
    }
  }

  async #detachEntry(entry: SidebarSurfaceEntry, focus: boolean): Promise<void> {
    if (entry.window && !entry.window.isDestroyed()) {
      this.#sendState(entry);
      if (focus) this.#focusEntry(entry);
      return;
    }
    const window = new BrowserWindow({
      title: entry.descriptor.label,
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
    entry.window = window;
    entry.notifyOnClose = true;
    entry.disposing = false;
    window.on("resize", () => {
      if (
        entry.parent === "detached" &&
        !entry.view.webContents.isDestroyed()
      ) {
        entry.view.setBounds(frameBounds(window));
      }
    });
    window.on("close", () => {
      if (!entry.disposing) this.#attachToMain(entry, false);
    });
    window.on("closed", () => this.#finishWindowClosed(entry, window));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("did-finish-load", () => this.#sendState(entry));

    try {
      await window.loadURL(this.#options.shellUrl);
      if (
        this.#entries.get(entry.descriptor.surfaceId) !== entry ||
        entry.window !== window
      ) {
        throw new Error("Detached Sidebar surface was replaced during setup");
      }
      this.#sendState(entry);
      this.#attachToDetached(entry, window);
      window.show();
      if (focus) this.#focusEntry(entry);
    } catch (error) {
      this.#disposeEntry(entry);
      throw error;
    }
  }

  #matchingEntry(
    surfaceId: string,
    presentationId?: string,
  ): SidebarSurfaceEntry | null {
    const entry = this.#entries.get(surfaceId) || null;
    if (
      !entry ||
      (presentationId && entry.descriptor.presentationId !== presentationId)
    ) {
      return null;
    }
    return entry;
  }

  #entryForShellContents(contents: WebContents): SidebarSurfaceEntry | null {
    for (const entry of this.#entries.values()) {
      if (entry.window?.webContents === contents) return entry;
    }
    return null;
  }

  #focusEntry(entry: SidebarSurfaceEntry): void {
    const window = entry.window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  #sendState(entry: SidebarSurfaceEntry): void {
    const contents = entry.window?.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.send("te2-desktop:sidebar-surface-state", entry.descriptor);
    }
  }

  #attachToMain(entry: SidebarSurfaceEntry, visible: boolean): void {
    const mainWindow = this.#options.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      this.#removeFromParent(entry);
      return;
    }
    if (entry.parent !== "main") {
      this.#removeFromParent(entry);
      mainWindow.contentView.addChildView(entry.view);
      entry.parent = "main";
    }
    entry.view.setVisible(visible);
  }

  #attachToDetached(
    entry: SidebarSurfaceEntry,
    window: BrowserWindow,
  ): void {
    this.#removeFromParent(entry);
    window.contentView.addChildView(entry.view);
    entry.parent = "detached";
    entry.view.setBounds(frameBounds(window));
    entry.view.setVisible(true);
  }

  #removeFromParent(entry: SidebarSurfaceEntry): void {
    if (entry.parent === "main") {
      try {
        this.#options.getMainWindow()?.contentView.removeChildView(entry.view);
      } catch {}
    } else if (entry.parent === "detached") {
      try {
        entry.window?.contentView.removeChildView(entry.view);
      } catch {}
    }
    entry.parent = "none";
    if (!entry.view.webContents.isDestroyed()) entry.view.setVisible(false);
  }

  #layoutEntry(entry: SidebarSurfaceEntry): void {
    if (entry.parent !== "main" || entry.view.webContents.isDestroyed()) return;
    const appBounds = this.#options.getAppViewBounds();
    const zoom = Math.max(0.25, this.#options.getAppZoomFactor() || 1);
    const relative = entry.embeddedBounds;
    const x = appBounds.x + Math.round(relative.x * zoom);
    const y = appBounds.y + Math.round(relative.y * zoom);
    const maxWidth = Math.max(0, appBounds.x + appBounds.width - x);
    const maxHeight = Math.max(0, appBounds.y + appBounds.height - y);
    const width = Math.min(maxWidth, Math.max(0, Math.round(relative.width * zoom)));
    const height = Math.min(
      maxHeight,
      Math.max(0, Math.round(relative.height * zoom)),
    );
    entry.view.setBounds({ x, y, width, height });
    entry.view.setVisible(
      entry.embeddedVisible && width > 0 && height > 0 && !entry.loadPromise,
    );
  }

  #closeAndDispose(entry: SidebarSurfaceEntry, notify: boolean): void {
    if (notify) this.#emitClosed(entry);
    this.#disposeEntry(entry);
  }

  #disposeEntry(entry: SidebarSurfaceEntry): void {
    if (entry.disposing) return;
    entry.disposing = true;
    const isCurrent = this.#entries.get(entry.descriptor.surfaceId) === entry;
    if (isCurrent) this.#entries.delete(entry.descriptor.surfaceId);
    this.#removeFromParent(entry);
    const window = entry.window;
    entry.window = null;
    this.#options.unregisterTrustedContents(entry.view.webContents);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    if (window && !window.isDestroyed()) window.close();
  }

  #finishWindowClosed(
    entry: SidebarSurfaceEntry,
    window: BrowserWindow,
  ): void {
    if (entry.window === window) entry.window = null;
    if (entry.disposing) return;
    if (!entry.persistent) {
      const notify = entry.notifyOnClose;
      this.#disposeEntry(entry);
      if (notify) this.#emitClosed(entry);
      return;
    }
    this.#layoutEntry(entry);
    if (entry.notifyOnClose) this.#emitClosed(entry);
  }

  #emitClosed(entry: SidebarSurfaceEntry): void {
    this.#emitToApp({
      type: "closed",
      hostId: entry.descriptor.hostId,
      surfaceId: entry.descriptor.surfaceId,
      presentationId: entry.descriptor.presentationId,
    });
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
