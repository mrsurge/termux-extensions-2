import { resolve } from "node:path";

import {
  BrowserWindow,
  screen,
  WebContentsView,
  type WebContents,
} from "electron";

import type {
  ElectronEditorSurfaceBounds,
  ElectronEditorSurfaceMode,
  ElectronEditorSurfacePresentation,
  ElectronSecondEditorCommand,
} from "../shared/app-view-contracts";
import {
  clampEditorWindowBounds,
  readSecondaryEditorPresentation,
  writeSecondaryEditorPresentation,
} from "./desktop-state-store";

type EditorParent = "none" | "main" | "detached";

export interface SecondaryEditorRegistryOptions {
  getAppPath(): string;
  getMainWindow(): BrowserWindow | null;
  getAppViewBounds(): Electron.Rectangle;
  getAppZoomFactor(): number;
  getConfiguredFrameworkOrigin(): string;
  getRelayOrigin(): string;
  getZoomFactor(): number;
  frameworkPartition: string;
  registerContents(contents: WebContents): void;
  unregisterContents(contents: WebContents): void;
  installContextMenu(
    contents: WebContents,
    owner: () => BrowserWindow | null,
  ): void;
  installScrollbars(contents: WebContents): Promise<void>;
  installAppChrome(contents: WebContents): Promise<void>;
  closeDialogs(contents: WebContents): void;
  publishPresentation(command: ElectronSecondEditorCommand): void;
  layoutPrimary(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedProjectPath(value: unknown): string {
  const projectPath = typeof value === "string" ? value.trim() : "";
  if (!projectPath) throw new Error("Secondary editor project path is required");
  return projectPath;
}

function normalizedFilePath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) throw new Error("Secondary editor file path is required");
  return path;
}

function normalizedEmbeddedBounds(value: unknown): ElectronEditorSurfaceBounds {
  if (!value || typeof value !== "object") {
    throw new Error("Secondary editor placement bounds are required");
  }
  const raw = value as Record<string, unknown>;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new Error("Secondary editor placement bounds are invalid");
  }
  return { x, y, width, height };
}

export class SecondaryEditorRegistry {
  readonly #options: SecondaryEditorRegistryOptions;
  #view: WebContentsView | null = null;
  #window: BrowserWindow | null = null;
  #parent: EditorParent = "none";
  #projectPath = "";
  #presentation: ElectronEditorSurfacePresentation | null = null;
  #ready = false;
  #pendingOpenPath = "";
  #loadGeneration = 0;
  #disposing = false;
  #closingWindowInternally = false;
  #boundsWriteTimer: ReturnType<typeof setTimeout> | null = null;
  #embeddedBounds: ElectronEditorSurfaceBounds = { x: 0, y: 0, width: 0, height: 0 };
  #embeddedVisible = false;

  constructor(options: SecondaryEditorRegistryOptions) {
    this.#options = options;
  }

  ownsContents(contents: WebContents): boolean {
    return Boolean(this.#view && this.#view.webContents === contents);
  }

  ownerWindow(contents: WebContents): BrowserWindow | null {
    if (!this.ownsContents(contents)) return null;
    return this.#window && !this.#window.isDestroyed()
      ? this.#window
      : this.#options.getMainWindow();
  }

  setZoomFactor(value: number): void {
    const contents = this.#view?.webContents;
    if (contents && !contents.isDestroyed()) contents.setZoomFactor(value);
  }

  reload(): void {
    const contents = this.#view?.webContents;
    if (contents && !contents.isDestroyed()) contents.reloadIgnoringCache();
  }

  async open(
    rawProjectPath: unknown,
    rawPath: unknown,
  ): Promise<ElectronEditorSurfacePresentation> {
    const projectPath = normalizedProjectPath(rawProjectPath);
    const path = normalizedFilePath(rawPath);
    await this.syncProject(projectPath);
    if (!this.#presentation) throw new Error("Secondary editor state is unavailable");
    if (this.#presentation.mode === "closed") {
      await this.#setPresentation({ ...this.#presentation, mode: "docked" });
    }
    this.#pendingOpenPath = path;
    await this.#ensureView();
    this.#applyPresentation();
    this.#sendState();
    this.#sendPendingOpen();
    return this.#copyPresentation();
  }

  async syncProject(
    rawProjectPath: unknown,
  ): Promise<ElectronEditorSurfacePresentation> {
    const projectPath = normalizedProjectPath(rawProjectPath);
    if (projectPath === this.#projectPath && this.#presentation) {
      return this.#copyPresentation();
    }
    this.#disposeView();
    this.#projectPath = projectPath;
    this.#pendingOpenPath = "";
    this.#presentation = await readSecondaryEditorPresentation(
      this.#options.getConfiguredFrameworkOrigin(),
      projectPath,
    );
    if (this.#presentation.mode !== "closed") {
      await this.#ensureView();
      this.#applyPresentation();
    }
    this.#sendState();
    this.#options.layoutPrimary();
    return this.#copyPresentation();
  }

  async setMode(
    mode: ElectronEditorSurfaceMode,
  ): Promise<ElectronEditorSurfacePresentation> {
    if (!this.#projectPath || !this.#presentation) {
      throw new Error("Secondary editor has no active project");
    }
    const window = this.#window;
    const detachedBounds =
      window && !window.isDestroyed() && !window.isMaximized()
        ? window.getBounds()
        : this.#presentation.detachedBounds;
    await this.#setPresentation({
      ...this.#presentation,
      mode,
      detachedBounds,
      maximized:
        window && !window.isDestroyed()
          ? window.isMaximized()
          : this.#presentation.maximized,
    });
    if (mode === "closed") {
      this.#sendState();
      this.#options.layoutPrimary();
      const result = this.#copyPresentation();
      setImmediate(() => {
        if (this.#presentation?.mode === "closed") this.#disposeView();
      });
      return result;
    }
    await this.#ensureView();
    this.#applyPresentation();
    this.#sendState();
    this.#options.layoutPrimary();
    return this.#copyPresentation();
  }

  handleReady(contents: WebContents): boolean {
    if (!this.ownsContents(contents)) return false;
    this.#ready = true;
    this.#sendState();
    this.#sendPendingOpen();
    return true;
  }

  place(rawBounds: unknown, rawVisible: unknown): void {
    this.#embeddedBounds = normalizedEmbeddedBounds(rawBounds);
    this.#embeddedVisible = rawVisible === true;
    this.#layoutEmbedded();
  }

  async setDockSize(rawDockSize: unknown): Promise<ElectronEditorSurfacePresentation> {
    if (!this.#projectPath || !this.#presentation) {
      throw new Error("Secondary editor has no active project");
    }
    const dockSize = Number(rawDockSize);
    if (!Number.isFinite(dockSize)) {
      throw new Error("Secondary editor dock size is invalid");
    }
    await this.#setPresentation({
      ...this.#presentation,
      dockSize,
    });
    this.#sendState();
    this.#options.layoutPrimary();
    return this.#copyPresentation();
  }

  layout(): void {
    this.#layoutEmbedded();
    this.#layoutDetached();
  }

  closeAll(): void {
    this.#projectPath = "";
    this.#presentation = null;
    this.#pendingOpenPath = "";
    this.#embeddedVisible = false;
    this.#embeddedBounds = { x: 0, y: 0, width: 0, height: 0 };
    this.#disposeView();
    this.#options.layoutPrimary();
  }

  #copyPresentation(): ElectronEditorSurfacePresentation {
    if (!this.#presentation) {
      throw new Error("Secondary editor presentation is unavailable");
    }
    return {
      ...this.#presentation,
      detachedBounds: { ...this.#presentation.detachedBounds },
    };
  }

  async #setPresentation(
    presentation: ElectronEditorSurfacePresentation,
  ): Promise<void> {
    this.#presentation = await writeSecondaryEditorPresentation(
      this.#options.getConfiguredFrameworkOrigin(),
      this.#projectPath,
      presentation,
    );
  }

  async #ensureView(): Promise<void> {
    if (this.#view && !this.#view.webContents.isDestroyed()) return;
    const generation = ++this.#loadGeneration;
    const view = new WebContentsView({
      webPreferences: {
        preload: resolve(this.#options.getAppPath(), "dist", "app-view-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: this.#options.frameworkPartition,
      },
    });
    this.#view = view;
    this.#parent = "none";
    this.#ready = false;
    view.setBackgroundColor("#0d1117");
    view.setVisible(false);
    view.webContents.setZoomFactor(this.#options.getZoomFactor());
    this.#options.registerContents(view.webContents);
    this.#options.installContextMenu(
      view.webContents,
      () => this.ownerWindow(view.webContents),
    );
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("dom-ready", () => {
      void this.#options.installAppChrome(view.webContents).catch((error) => {
        console.warn(
          `[te2-desktop] Secondary editor chrome install failed: ${errorMessage(error)}`,
        );
      });
      void this.#options.installScrollbars(view.webContents).catch((error) => {
        console.warn(
          `[te2-desktop] Secondary editor scrollbar install failed: ${errorMessage(error)}`,
        );
      });
    });
    view.webContents.on("did-fail-load", (_event, code, description, url) => {
      if (code !== -3) {
        console.error(
          `[te2-desktop] Secondary editor load failed ${code} ${description}: ${url}`,
        );
      }
    });
    view.webContents.on("render-process-gone", (_event, details) => {
      if (this.#disposing || this.#view !== view) return;
      console.error(
        `[te2-desktop] Secondary editor renderer exited: ${details.reason}`,
      );
      this.#disposeView();
      if (this.#presentation?.mode !== "closed" && this.#projectPath) {
        void this.#ensureView()
          .then(() => this.#applyPresentation())
          .catch((error) => {
            console.error(
              `[te2-desktop] Secondary editor recovery failed: ${errorMessage(error)}`,
            );
          });
      }
    });

    const target = new URL("/app/code_te2", this.#options.getRelayOrigin());
    target.searchParams.set("gv_native", "1");
    target.searchParams.set("te2_editor_role", "secondary");
    target.searchParams.set("te2_desktop_editor", "secondary");
    await view.webContents.loadURL(target.href);
    if (this.#view !== view || generation !== this.#loadGeneration) {
      throw new Error("Secondary editor renderer was replaced during navigation");
    }
  }

  #applyPresentation(): void {
    const presentation = this.#presentation;
    if (!presentation || !this.#view || this.#view.webContents.isDestroyed()) return;
    if (presentation.mode === "detached") {
      this.#attachToDetached();
    } else if (presentation.mode === "docked" || presentation.mode === "collapsed") {
      this.#attachToMain();
    }
    this.#options.layoutPrimary();
  }

  #layoutEmbedded(): void {
    const view = this.#view;
    const presentation = this.#presentation;
    if (!view || view.webContents.isDestroyed() || this.#parent !== "main") return;
    if (
      !presentation ||
      (presentation.mode !== "docked" && presentation.mode !== "collapsed")
    ) {
      view.setVisible(false);
      return;
    }
    const appBounds = this.#options.getAppViewBounds();
    const zoom = Math.max(0.25, this.#options.getAppZoomFactor() || 1);
    const relative = this.#embeddedBounds;
    const x = appBounds.x + Math.round(relative.x * zoom);
    const y = appBounds.y + Math.round(relative.y * zoom);
    const maxWidth = Math.max(0, appBounds.x + appBounds.width - x);
    const maxHeight = Math.max(0, appBounds.y + appBounds.height - y);
    const width = Math.min(maxWidth, Math.max(0, Math.round(relative.width * zoom)));
    const height = Math.min(maxHeight, Math.max(0, Math.round(relative.height * zoom)));
    view.setBounds({ x, y, width, height });
    view.setVisible(this.#embeddedVisible && width > 0 && height > 0);
  }

  #attachToMain(): void {
    const view = this.#view;
    const mainWindow = this.#options.getMainWindow();
    if (!view || !mainWindow || mainWindow.isDestroyed()) return;
    if (this.#parent !== "main") {
      this.#removeFromParent();
      mainWindow.contentView.addChildView(view);
      this.#parent = "main";
    }
    this.#closeDetachedWindow();
  }

  #attachToDetached(): void {
    const view = this.#view;
    const presentation = this.#presentation;
    const mainWindow = this.#options.getMainWindow();
    if (!view || !presentation || !mainWindow || mainWindow.isDestroyed()) return;
    let window = this.#window;
    if (!window || window.isDestroyed()) {
      const workArea = screen.getDisplayMatching(presentation.detachedBounds).workArea;
      const bounds = clampEditorWindowBounds(presentation.detachedBounds, workArea);
      window = new BrowserWindow({
        title: "Code TE2 - Second Window",
        ...bounds,
        minWidth: 440,
        minHeight: 300,
        frame: false,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#0d1117",
      });
      window.setMenu(null);
      this.#window = window;
      window.on("resize", () => {
        this.#layoutDetached();
        this.#queueDetachedBoundsWrite();
      });
      window.on("move", () => this.#queueDetachedBoundsWrite());
      window.on("maximize", () => this.#queueDetachedBoundsWrite());
      window.on("unmaximize", () => this.#queueDetachedBoundsWrite());
      window.on("close", (event) => {
        if (this.#closingWindowInternally || this.#disposing) return;
        event.preventDefault();
        void this.setMode("closed").catch((error) => {
          console.error(
            `[te2-desktop] Secondary editor close failed: ${errorMessage(error)}`,
          );
        });
      });
      window.on("closed", () => {
        if (this.#window === window) this.#window = null;
      });
    }
    if (this.#parent !== "detached") {
      this.#removeFromParent();
      window.contentView.addChildView(view);
      this.#parent = "detached";
    }
    this.#layoutDetached();
    view.setVisible(true);
    if (presentation.maximized) window.maximize();
    window.show();
    window.focus();
  }

  #layoutDetached(): void {
    const window = this.#window;
    const view = this.#view;
    if (
      !window ||
      window.isDestroyed() ||
      !view ||
      view.webContents.isDestroyed() ||
      this.#parent !== "detached"
    ) return;
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  }

  #removeFromParent(): void {
    const view = this.#view;
    if (!view) return;
    try {
      if (this.#parent === "main") {
        this.#options.getMainWindow()?.contentView.removeChildView(view);
      } else if (this.#parent === "detached") {
        this.#window?.contentView.removeChildView(view);
      }
    } catch {}
    this.#parent = "none";
    if (!view.webContents.isDestroyed()) view.setVisible(false);
  }

  #closeDetachedWindow(): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    this.#window = null;
    this.#closingWindowInternally = true;
    try {
      window.close();
    } finally {
      this.#closingWindowInternally = false;
    }
  }

  #queueDetachedBoundsWrite(): void {
    if (!this.#window || this.#window.isDestroyed() || !this.#presentation) return;
    if (this.#boundsWriteTimer) clearTimeout(this.#boundsWriteTimer);
    this.#boundsWriteTimer = setTimeout(() => {
      this.#boundsWriteTimer = null;
      const window = this.#window;
      const current = this.#presentation;
      if (!window || window.isDestroyed() || !current || !this.#projectPath) return;
      const detachedBounds = window.isMaximized()
        ? current.detachedBounds
        : window.getBounds();
      void this.#setPresentation({
        ...current,
        detachedBounds,
        maximized: window.isMaximized(),
      }).then(() => this.#sendState()).catch((error) => {
        console.warn(
          `[te2-desktop] Secondary editor bounds were not persisted: ${errorMessage(error)}`,
        );
      });
    }, 160);
  }

  #sendState(): void {
    if (!this.#presentation) return;
    const command: ElectronSecondEditorCommand = {
      type: "state",
      projectPath: this.#projectPath,
      presentation: this.#copyPresentation(),
    };
    this.#options.publishPresentation(command);
    const contents = this.#view?.webContents;
    if (!this.#ready || !contents || contents.isDestroyed()) return;
    contents.send("te2-desktop:second-editor-command", command);
  }

  #sendPendingOpen(): void {
    const contents = this.#view?.webContents;
    if (!this.#ready || !contents || contents.isDestroyed() || !this.#pendingOpenPath) return;
    const command: ElectronSecondEditorCommand = {
      type: "open",
      projectPath: this.#projectPath,
      path: this.#pendingOpenPath,
    };
    this.#pendingOpenPath = "";
    contents.send("te2-desktop:second-editor-command", command);
  }

  #disposeView(): void {
    this.#disposing = true;
    this.#loadGeneration += 1;
    this.#ready = false;
    if (this.#boundsWriteTimer) {
      clearTimeout(this.#boundsWriteTimer);
      this.#boundsWriteTimer = null;
    }
    const view = this.#view;
    this.#removeFromParent();
    this.#view = null;
    if (view) {
      this.#options.closeDialogs(view.webContents);
      this.#options.unregisterContents(view.webContents);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.#closeDetachedWindow();
    this.#parent = "none";
    this.#disposing = false;
  }
}
