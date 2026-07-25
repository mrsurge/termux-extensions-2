import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  protocol,
  session,
  WebContentsView,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import { clearFrameworkAssetCaches } from "./asset-cache";
import { DesktopAssetManager, MIME_TYPES } from "./assets";
import { DesktopDialogHost } from "./dialog-host";
import {
  FRAMEWORK_REQUEST_TIMEOUT_MS,
  frameworkConnectionError,
} from "./framework-errors";
import { startFrameworkRelay, type FrameworkRelay } from "./framework-relay";
import {
  ELECTRON_APP_VIEW_IDENTITY,
  ELECTRON_FRAMEWORK_PARTITION,
  validateElectronAppViewCommand,
  type ElectronAppViewInspection,
} from "../shared/app-view-contracts";
import {
  frameworkOrigin,
  readDesktopSettings,
  validZoom,
  writeDesktopSettings,
} from "./target";
import type {
  AppNavigation,
  AssetUpdateResult,
  DesktopShellSettings,
  NativeRequestMethod,
} from "../shared/contracts";
import { settleNativeRequest } from "../shared/native-request-contracts";

const SHELL_SCHEME = "te2-desktop";
const SHELL_HOST = "shell";
const HEADER_HEIGHT = 46;
const APP_NATIVE_STYLE =
  "html > body > .app-shell > .app-toolbar{display:none!important}";
const FRAMEWORK_ROUTE =
  /^\/api\/apps\/(?:(?:catalog|reload)|(?:[A-Za-z0-9._-]+)\/(?:open|quit))$/;

protocol.registerSchemesAsPrivileged([
  {
    scheme: SHELL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

if (process.platform === "linux") {
  // Electron 38+ selects native Wayland when the session supports it. Keeping
  // the hint at auto avoids the X11-only path that constrained the CEF spike.
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

type FrameworkRequestParams = {
  path: string;
  method?: string;
  body?: unknown;
};

type ApiEnvelope = {
  ok?: unknown;
  data?: unknown;
  error?: unknown;
};

let mainWindow: BrowserWindow | null = null;
let appView: WebContentsView | null = null;
let settings: DesktopShellSettings;
let configuredFrameworkOrigin: string;
let relay: FrameworkRelay;
let dialogHost: DesktopDialogHost | null = null;
const surfaceWindows = new Set<BrowserWindow>();
const assets = new DesktopAssetManager();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function apiError(envelope: unknown, fallback: string): Error {
  if (envelope && typeof envelope === "object" && "error" in envelope) {
    const message = String((envelope as ApiEnvelope).error || "").trim();
    if (message) return new Error(message);
  }
  return new Error(fallback);
}

function shellRendererRoot(): string {
  return resolve(app.getAppPath(), "dist", "renderer");
}

async function localShellResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== SHELL_HOST) return new Response("Not found", { status: 404 });

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Invalid path", { status: 400 });
  }
  const root = shellRendererRoot();
  const target = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const targetRelative = relative(root, target);
  if (!targetRelative || targetRelative.startsWith("..")) {
    return new Response("Not found", { status: 404 });
  }
  try {
    if (!(await stat(target)).isFile()) throw new Error("Not a file");
    const body = new Uint8Array(await readFile(target));
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": MIME_TYPES[extname(target).toLowerCase()] || "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function frameworkRequest(params: FrameworkRequestParams): Promise<unknown> {
  const method = String(params.method || "GET").toUpperCase();
  const path = String(params.path || "");
  if (method !== "GET" && method !== "POST") {
    throw new Error("Unsupported framework request method");
  }
  if (!FRAMEWORK_ROUTE.test(path)) {
    throw new Error("Unsupported framework request path");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(FRAMEWORK_REQUEST_TIMEOUT_MS),
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = params.body === undefined || params.body === null
      ? ""
      : JSON.stringify(params.body);
  }
  let response: Response;
  try {
    response = await fetch(`${configuredFrameworkOrigin}${path}`, init);
  } catch (error) {
    throw frameworkConnectionError(error);
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("Framework returned invalid JSON");
  }
  if (!response.ok) throw apiError(envelope, `Framework returned HTTP ${response.status}`);
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Framework returned an invalid response");
  }
  const body = envelope as ApiEnvelope;
  if (body.ok === false) throw apiError(envelope, "Framework request failed");
  return body.data;
}

async function frameworkStatus(): Promise<{
  online: boolean;
  frameworkBaseUrl: string;
  error?: string;
}> {
  try {
    await frameworkRequest({ path: "/api/apps/catalog" });
    return { online: true, frameworkBaseUrl: configuredFrameworkOrigin };
  } catch (error) {
    return {
      online: false,
      frameworkBaseUrl: configuredFrameworkOrigin,
      error: errorMessage(error),
    };
  }
}

async function fwsStatus(): Promise<{ available: boolean; url: string; error?: string }> {
  const url = `${relay.browserOrigin}/fws`;
  try {
    const response = await fetch(`${configuredFrameworkOrigin}/fws`, {
      signal: AbortSignal.timeout(FRAMEWORK_REQUEST_TIMEOUT_MS),
    });
    return { available: response.status >= 200 && response.status < 400, url };
  } catch (error) {
    return { available: false, url, error: frameworkConnectionError(error).message };
  }
}

function sendToShell(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function sendNavigation(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  const navigation: AppNavigation = {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  };
  sendToShell("te2-desktop:app-navigation", navigation);
}

function appViewBounds(): Electron.Rectangle {
  const [width, height] = mainWindow?.getContentSize() || [0, 0];
  return { x: 0, y: HEADER_HEIGHT, width, height: Math.max(0, height - HEADER_HEIGHT) };
}

function resizeAppView(): void {
  appView?.setBounds(appViewBounds());
}

function closeSurfaceWindows(): void {
  for (const window of [...surfaceWindows]) {
    surfaceWindows.delete(window);
    if (!window.isDestroyed()) window.close();
  }
}

function closeAppView(): void {
  if (!appView) return;
  const closing = appView;
  closeSurfaceWindows();
  dialogHost?.closeForOwner(closing.webContents);
  appView = null;
  mainWindow?.contentView.removeChildView(closing);
  if (!closing.webContents.isDestroyed()) closing.webContents.close();
}

function assertTrustedAppViewSender(contents: WebContents): void {
  const current = appView?.webContents;
  if (!current || current.isDestroyed() || contents !== current) {
    throw new Error("Rejected Electron app-view command from a stale renderer");
  }
  let origin = "";
  try {
    origin = new URL(contents.getURL()).origin;
  } catch {
    // The empty origin is rejected below.
  }
  if (origin !== relay.browserOrigin) {
    throw new Error("Rejected Electron app-view command from an untrusted origin");
  }
}

async function updateDesktopAssets(
  force: boolean,
  reloadActiveView: boolean,
): Promise<AssetUpdateResult> {
  const result = await assets.updateFromServer(
    configuredFrameworkOrigin,
    relay.browserOrigin,
    force,
  );
  await relay.refreshAssets();
  if (!result.updated) return result;

  await clearFrameworkAssetCaches(session.fromPartition(ELECTRON_FRAMEWORK_PARTITION));
  sendToShell("te2-desktop:asset-updated", result.localVersion);
  const contents = appView?.webContents;
  if (reloadActiveView && contents && !contents.isDestroyed()) {
    contents.reloadIgnoringCache();
  }
  return result;
}

async function handleAppViewControl(
  event: IpcMainInvokeEvent,
  rawCommand: unknown,
): Promise<unknown> {
  assertTrustedAppViewSender(event.sender);
  const command = validateElectronAppViewCommand(rawCommand);
  if (command === "inspect") {
    const frameworkSession = session.fromPartition(ELECTRON_FRAMEWORK_PARTITION);
    const [assetStatus, cacheSizeBytes] = await Promise.all([
      assets.status(relay.browserOrigin),
      frameworkSession.getCacheSize(),
    ]);
    const inspection: ElectronAppViewInspection = {
      identity: ELECTRON_APP_VIEW_IDENTITY,
      currentUrl: event.sender.getURL(),
      relayOrigin: relay.browserOrigin,
      configuredFrameworkOrigin,
      sessionPartition: ELECTRON_FRAMEWORK_PARTITION,
      cacheSizeBytes,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      assets: assetStatus,
    };
    return inspection;
  }
  if (command === "force_asset_update") {
    // Keep this renderer alive long enough to return the install result. The
    // paired reload hook activates the already-invalidated asset snapshot.
    return updateDesktopAssets(true, false);
  }
  if (command === "reload") {
    const contents = event.sender;
    setImmediate(() => {
      if (appView?.webContents === contents && !contents.isDestroyed()) {
        contents.reloadIgnoringCache();
      }
    });
    return { ok: true };
  }
  const contents = event.sender;
  setImmediate(() => {
    if (appView?.webContents === contents && !contents.isDestroyed()) {
      sendToShell("te2-desktop:steer", "home");
    }
  });
  return { ok: true };
}

function installContextMenu(contents: WebContents): void {
  contents.on("context-menu", (event, params) => {
    event.preventDefault();
    contents.focus();
    const canCopy = params.editFlags.canCopy || Boolean(params.selectionText);
    const canPaste = params.editFlags.canPaste || params.isEditable;
    const menu = Menu.buildFromTemplate([
      {
        label: "Copy",
        accelerator: "CmdOrCtrl+C",
        enabled: canCopy,
        click: () => contents.copy(),
      },
      {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        enabled: canPaste,
        click: () => contents.paste(),
      },
    ]);
    const ownerWindow = BrowserWindow.fromWebContents(contents) || mainWindow;
    if (ownerWindow && !ownerWindow.isDestroyed()) {
      menu.popup({ window: ownerWindow });
    }
  });
}

function createAppView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: resolve(app.getAppPath(), "dist", "app-view-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: ELECTRON_FRAMEWORK_PARTITION,
    },
  });
  view.setBackgroundColor("#111315");
  view.webContents.setZoomFactor(settings.zoomLevel);
  installContextMenu(view.webContents);
  view.webContents.on("dom-ready", () => {
    void view.webContents.insertCSS(APP_NATIVE_STYLE, { cssOrigin: "user" }).catch((error) => {
      console.error(`[te2-desktop] Failed to install app chrome CSS: ${errorMessage(error)}`);
    });
  });

  const notify = () => sendNavigation(view.webContents);
  view.webContents.on("will-navigate", () => {
    closeSurfaceWindows();
    dialogHost?.closeForOwner(view.webContents);
  });
  view.webContents.on("did-navigate", notify);
  view.webContents.on("did-navigate-in-page", () => {
    closeSurfaceWindows();
    dialogHost?.closeForOwner(view.webContents);
    notify();
  });
  view.webContents.on("did-finish-load", notify);
  view.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    notify();
  });
  view.webContents.on("did-fail-load", (_event, code, description, url) => {
    if (code !== -3) {
      console.error(`[te2-desktop] App load failed ${code} ${description}: ${url}`);
    }
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    closeSurfaceWindows();
    dialogHost?.closeForOwner(view.webContents);
    console.error(`[te2-desktop] App renderer exited: ${details.reason}`);
  });
  view.webContents.on("did-create-window", (window, details) => {
    if (details.frameName !== "te2-modal-surface") {
      if (!window.isDestroyed()) window.close();
      return;
    }
    surfaceWindows.add(window);
    window.setMenu(null);
    installContextMenu(window.webContents);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => surfaceWindows.delete(window));
  });
  view.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === "about:blank" && frameName === "te2-modal-surface") {
      const [mainWidth, mainHeight] = mainWindow?.getContentSize() || [1000, 760];
      return {
        action: "allow",
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          parent: mainWindow || undefined,
          modal: true,
          frame: false,
          show: true,
          width: Math.max(420, Math.min(1000, mainWidth - 48)),
          height: Math.max(320, Math.min(760, mainHeight - 48)),
          minWidth: 360,
          minHeight: 240,
          backgroundColor: "#111315",
          autoHideMenuBar: true,
          skipTaskbar: true,
          useContentSize: true,
        },
      };
    }
    try {
      const target = new URL(url);
      if (target.origin === relay.browserOrigin) {
        void view.webContents.loadURL(target.href);
      }
    } catch {
      // Reject malformed popup URLs.
    }
    return { action: "deny" };
  });

  const frameworkSession = view.webContents.session;
  frameworkSession.setPermissionRequestHandler((requestingContents, permission, callback) => {
    let allowed = false;
    try {
      allowed = requestingContents === view.webContents &&
        new URL(requestingContents.getURL()).origin === relay.browserOrigin &&
        ["clipboard-read", "clipboard-sanitized-write"].includes(String(permission));
    } catch {
      allowed = false;
    }
    callback(allowed);
  });
  return view;
}

async function navigateApp(rawUrl: string): Promise<{ url: string }> {
  const target = new URL(rawUrl, `${relay.browserOrigin}/`);
  if (target.origin !== relay.browserOrigin || !/^https?:$/.test(target.protocol)) {
    throw new Error("Framework app navigation must use the desktop relay origin");
  }
  target.searchParams.set("gv_native", "1");
  closeAppView();
  appView = createAppView();
  mainWindow?.contentView.addChildView(appView);
  resizeAppView();
  await appView.webContents.loadURL(target.href);
  return { url: target.href };
}

async function saveConnection(params: Record<string, unknown>): Promise<{
  settings: DesktopShellSettings;
  browserFrameworkOrigin: string;
  connectionChanged: boolean;
}> {
  const candidate: DesktopShellSettings = {
    ...settings,
    frameworkHost: String(params.frameworkHost || "").trim(),
    frameworkPort: Number(params.frameworkPort),
  };
  const previousOrigin = configuredFrameworkOrigin;
  const nextOrigin = frameworkOrigin(candidate);
  settings = await writeDesktopSettings(candidate);
  configuredFrameworkOrigin = nextOrigin;
  if (nextOrigin !== previousOrigin) {
    relay.retarget(nextOrigin);
    closeAppView();
  }
  return {
    settings,
    browserFrameworkOrigin: relay.browserOrigin,
    connectionChanged: nextOrigin !== previousOrigin,
  };
}

async function viewAction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const action = String(params.action || "");
  if (action === "home") closeAppView();
  else if (action === "back" && appView?.webContents.navigationHistory.canGoBack()) {
    appView.webContents.navigationHistory.goBack();
  } else if (action === "forward" && appView?.webContents.navigationHistory.canGoForward()) {
    appView.webContents.navigationHistory.goForward();
  } else if (action === "reload") appView?.webContents.reloadIgnoringCache();
  else if (action === "recents") {
    await appView?.webContents.executeJavaScript(
      'document.getElementById("btn-recents")?.click()',
      true,
    );
  } else if (action === "lock") {
    await appView?.webContents.executeJavaScript(
      'document.getElementById("btn-lock")?.click()',
      true,
    );
  } else if (action === "set_zoom") {
    settings = await writeDesktopSettings({
      ...settings,
      zoomLevel: validZoom(params.zoomLevel),
    });
    appView?.webContents.setZoomFactor(settings.zoomLevel);
    return { zoomLevel: settings.zoomLevel };
  } else if (!action) throw new Error("Missing view action");
  return {};
}

async function nativeRequest(
  method: NativeRequestMethod,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (method === "get_settings") return settings;
  if (method === "get_browser_framework_origin") return { origin: relay.browserOrigin };
  if (method === "save_settings") return saveConnection(params);
  if (method === "framework_request") {
    return frameworkRequest({
      path: String(params.path || ""),
      method: String(params.method || "GET"),
      body: params.body,
    });
  }
  if (method === "get_framework_status") return frameworkStatus();
  if (method === "get_fws_status") return fwsStatus();
  if (method === "get_asset_status") return assets.status(relay.browserOrigin);
  if (method === "update_assets") {
    return updateDesktopAssets(true, true);
  }
  if (method === "navigate_app") return navigateApp(String(params.url || ""));
  if (method === "view_action") return viewAction(params);
  if (method === "window_control") {
    const action = String(params.action || "");
    if (action === "minimize") mainWindow?.minimize();
    else if (action === "toggle_maximize") {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize();
      else mainWindow?.maximize();
      return { maximized: Boolean(mainWindow?.isMaximized()) };
    } else if (action === "close") mainWindow?.close();
    else throw new Error("Unsupported window control");
    return {};
  }
  if (method === "set_window_title") {
    mainWindow?.setTitle(String(params.title || "TE2 Desktop"));
    return {};
  }
  throw new Error(`Unknown native method: ${method}`);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "TE2 Desktop",
    width: 1360,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: "#111315",
    show: false,
    webPreferences: {
      preload: resolve(app.getAppPath(), "dist", "shell-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on("resize", resizeAppView);
  window.on("close", () => {
    closeSurfaceWindows();
    dialogHost?.closeAll();
    closeAppView();
  });
  window.on("closed", () => { mainWindow = null; });
  window.webContents.on("did-finish-load", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  installContextMenu(window.webContents);
  return window;
}

async function automaticAssetUpdate(): Promise<void> {
  try {
    const result = await updateDesktopAssets(false, true);
    if (!result.ok) {
      console.warn(`[te2-desktop-assets] ${result.error || "Asset update failed"}`);
    }
  } catch (error) {
    console.warn(`[te2-desktop-assets] Activation failed: ${errorMessage(error)}`);
  }
}

async function autoOpenConfiguredApp(): Promise<void> {
  if (process.env.TE2_DESKTOP_SPIKE_AUTO_OPEN !== "1") return;
  const appId = process.env.TE2_DESKTOP_SPIKE_APP_ID?.trim() || "file_editor_cm6";
  try {
    const direct = process.env.TE2_DESKTOP_SPIKE_URL?.trim();
    let target: URL;
    if (direct) {
      const source = new URL(direct, `${configuredFrameworkOrigin}/`);
      target = source.origin === configuredFrameworkOrigin
        ? new URL(`${source.pathname}${source.search}${source.hash}`, relay.browserOrigin)
        : source;
    } else {
      const result = await frameworkRequest({
        path: `/api/apps/${encodeURIComponent(appId)}/open`,
        method: "POST",
        body: { params: {} },
      }) as { url?: unknown } | undefined;
      const source = new URL(String(result?.url || `/app/${appId}`), configuredFrameworkOrigin);
      target = new URL(`${source.pathname}${source.search}${source.hash}`, relay.browserOrigin);
    }
    target.searchParams.set("gv_native", "1");
    await navigateApp(target.href);
  } catch (error) {
    console.error(`[te2-desktop-auto-open] ${errorMessage(error)}`);
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  await protocol.handle(SHELL_SCHEME, localShellResponse);

  settings = await readDesktopSettings();
  configuredFrameworkOrigin = frameworkOrigin(settings);
  relay = await startFrameworkRelay(configuredFrameworkOrigin, assets);

  mainWindow = createMainWindow();
  dialogHost = new DesktopDialogHost({
    getMainWindow: () => mainWindow,
    getAppContents: () => appView?.webContents || null,
    getRelayOrigin: () => relay.browserOrigin,
    getAppPath: () => app.getAppPath(),
    shellUrl: `${SHELL_SCHEME}://${SHELL_HOST}/dialog/index.html`,
    installContextMenu,
  });
  dialogHost.registerIpc();
  ipcMain.handle(
    "te2-desktop:native-request",
    (event, method: NativeRequestMethod, params: Record<string, unknown> = {}) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error("Rejected desktop request from an untrusted renderer");
      }
      return settleNativeRequest(() => nativeRequest(method, params));
    },
  );
  ipcMain.handle("te2-desktop:app-view-control", handleAppViewControl);
  await mainWindow.loadURL(`${SHELL_SCHEME}://${SHELL_HOST}/index.html`);

  console.log(
    `[te2-desktop] Electron ${process.versions.electron}; Chromium ${process.versions.chrome}; ` +
    `session=${process.env.XDG_SESSION_TYPE || "unknown"}; relay=${relay.browserOrigin}`,
  );
  void automaticAssetUpdate();
  void autoOpenConfiguredApp();

  const exitAfterSeconds = Number(process.env.TE2_DESKTOP_EXIT_AFTER_SECONDS || 0);
  if (Number.isFinite(exitAfterSeconds) && exitAfterSeconds > 0) {
    setTimeout(() => mainWindow?.close(), exitAfterSeconds * 1_000);
  }
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  ipcMain.removeHandler("te2-desktop:app-view-control");
  closeAppView();
  dialogHost?.dispose();
  dialogHost = null;
  void relay?.stop();
});

void main().catch((error) => {
  console.error(`[te2-desktop] ${errorMessage(error)}`);
  app.exit(1);
});
