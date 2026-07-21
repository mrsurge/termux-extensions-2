import Electrobun, { Electroview, type WebviewTagElement } from "electrobun/view";

import { appPreload } from "../bun/app-preload";
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, type DesktopShellSettings } from "../bun/target";
import type { DesktopShellRpc } from "../shared/rpc";

type PatchedWebview = WebviewTagElement & {
  setPageZoom(value: number): void;
  getPageZoom(): Promise<number>;
  reloadIgnoringCache(): void;
  setAssetRedirectRules(rules: string): void;
};

declare global {
  interface Window {
    __te2DesktopNativeRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    __te2DesktopNavigateApp?: (url: string) => void;
  }
}

const rpc = Electroview.defineRPC<DesktopShellRpc>({
  maxRequestTime: 180_000,
  handlers: {
    requests: {},
    messages: {
      assetUpdated: ({ version }) => void handleAssetUpdate(version, true),
    },
  },
});
const electrobun = new Electrobun.Electroview({ rpc });

const viewStack = document.querySelector("#view-stack") as HTMLElement;
const launcherView = document.querySelector("#launcher-view") as HTMLIFrameElement;
const pageTitle = document.querySelector("#page-title") as HTMLElement;
const assetVersion = document.querySelector("#asset-version") as HTMLElement;
const zoomReset = document.querySelector("#zoom-reset") as HTMLButtonElement;
const zoomOut = document.querySelector("#zoom-out") as HTMLButtonElement;
const zoomIn = document.querySelector("#zoom-in") as HTMLButtonElement;
const back = document.querySelector("#back") as HTMLButtonElement;
const forward = document.querySelector("#forward") as HTMLButtonElement;
const toastElement = document.querySelector("#native-toast") as HTMLElement;

let appView: PatchedWebview | null = null;
let currentUrl: URL | null = null;
let settings: DesktopShellSettings = await electrobun.rpc!.request.getSettings({});
let browserFrameworkOrigin = (
  await electrobun.rpc!.request.getBrowserFrameworkOrigin({})
).origin;
let zoomLevel = settings.zoomLevel;
let toastTimer = 0;

function toast(message: string): void {
  toastElement.textContent = message;
  toastElement.dataset.visible = "true";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => delete toastElement.dataset.visible, 3500);
}

function setAssetBadge(version: string | null): void {
  assetVersion.textContent = version ? `Assets v${version}` : "Assets unavailable";
}

function normalizeZoom(value: number): number {
  return Math.round(Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, value)) * 10) / 10;
}

async function setZoom(value: number): Promise<void> {
  zoomLevel = normalizeZoom(value);
  appView?.setPageZoom(zoomLevel);
  const saved = await electrobun.rpc!.request.saveZoom({ zoomLevel });
  zoomLevel = saved.zoomLevel;
  zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
  zoomOut.disabled = zoomLevel <= MIN_ZOOM_LEVEL;
  zoomIn.disabled = zoomLevel >= MAX_ZOOM_LEVEL;
}

async function updateNavigation(): Promise<void> {
  back.disabled = !appView || !(await appView.canGoBack());
  forward.disabled = !appView || !(await appView.canGoForward());
}

function appIdFromCurrentUrl(): string | null {
  if (!currentUrl || !/^https?:$/.test(currentUrl.protocol)) return null;
  if (currentUrl.origin !== browserFrameworkOrigin) return null;
  const match = currentUrl.pathname.match(/^\/app\/([A-Za-z0-9._-]+)(?:\/|$)/);
  const appId = match?.[1] || (currentUrl.pathname === "/app" ? currentUrl.searchParams.get("app_id") : null);
  return appId && /^[A-Za-z0-9._-]+$/.test(appId) ? appId : null;
}

async function applyAssetRules(view: PatchedWebview): Promise<void> {
  const result = await electrobun.rpc!.request.getAssetRedirectRules({});
  setAssetBadge(result.version);
  if (result.active) view.setAssetRedirectRules(result.rules);
}

function parseHostMessage(event: CustomEvent): Record<string, unknown> | null {
  const raw = (event.detail as { detail?: unknown } | undefined)?.detail ?? event.detail;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function waitForWebview(view: PatchedWebview): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (typeof view.webviewId === "number") return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("CEF app view did not initialize");
}

async function showApp(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  url.searchParams.set("gv_native", "1");
  appView?.remove();
  const view = document.createElement("electrobun-webview") as PatchedWebview;
  view.setAttribute("renderer", "cef");
  view.setAttribute("sandbox", "");
  view.setAttribute("partition", "te2-framework");
  view.setAttribute("preload", appPreload);
  // Create the CEF child on a neutral document so native asset rules are in
  // place before the framework template can issue its first subresource load.
  view.setAttribute("src", "about:blank");
  appView = view;
  currentUrl = url;
  launcherView.hidden = true;
  document.body.dataset.appOpen = "true";
  viewStack.appendChild(view);

  view.on("did-navigate", (event) => {
    const raw = (event.detail as { detail?: unknown } | undefined)?.detail ?? event.detail;
    try {
      currentUrl = new URL(String(raw));
      if (currentUrl.origin === new URL(url).origin && currentUrl.pathname === "/") showHome();
    } catch {}
    void updateNavigation();
  });
  view.on("did-navigate-in-page", () => void updateNavigation());
  view.on("host-message", (event) => {
    const message = parseHostMessage(event);
    if (!message) return;
    if (message.source === "te2-electrobun-spike") {
      electrobun.rpc!.send.reportDiagnostic(message);
      return;
    }
    if (message.source === "te2-desktop-shell" && message.phase === "navigation") {
      try { currentUrl = new URL(String(message.url)); } catch {}
      const title = String(message.title || "TE2 Desktop");
      pageTitle.textContent = title;
      void electrobun.rpc!.request.setWindowTitle({ title });
      void updateNavigation();
    }
  });

  await waitForWebview(view);
  await applyAssetRules(view);
  view.setPageZoom(zoomLevel);
  view.loadURL(url.href);
  await updateNavigation();
}

function showHome(): void {
  appView?.remove();
  appView = null;
  currentUrl = null;
  launcherView.hidden = false;
  launcherView.src = "./android_shell/index.html";
  delete document.body.dataset.appOpen;
  pageTitle.textContent = "TE2 Desktop";
  void electrobun.rpc!.request.setWindowTitle({ title: "TE2 Desktop" });
  void updateNavigation();
}

async function handleAssetUpdate(version: string | null, automatic: boolean): Promise<void> {
  setAssetBadge(version);
  if (appView) {
    await applyAssetRules(appView);
    appView.reloadIgnoringCache();
  }
  if (automatic) toast(`Desktop assets updated to v${version || "unknown"}`);
}

window.__te2DesktopNavigateApp = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "views:") {
      launcherView.src = url.href;
      launcherView.hidden = false;
      return;
    }
    void showApp(url.href).catch((error) => toast(String(error)));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
};
window.__te2DesktopNativeRequest = async (method, params = {}) => {
  if (method === "get_settings") return electrobun.rpc!.request.getSettings({});
  if (method === "get_browser_framework_origin") {
    return electrobun.rpc!.request.getBrowserFrameworkOrigin({});
  }
  if (method === "save_settings") {
    const result = await electrobun.rpc!.request.saveSettings({
      frameworkHost: String(params.frameworkHost || ""),
      frameworkPort: Number(params.frameworkPort),
    });
    settings = result.settings;
    browserFrameworkOrigin = result.browserFrameworkOrigin;
    return result;
  }
  if (method === "framework_request") {
    return electrobun.rpc!.request.frameworkRequest({
      path: String(params.path || ""),
      method: String(params.method || "GET").toUpperCase() as "GET" | "POST",
      body: params.body,
    });
  }
  if (method === "get_fws_status") return electrobun.rpc!.request.getFwsStatus({});
  if (method === "get_asset_status") return electrobun.rpc!.request.getAssetStatus({});
  if (method === "update_assets") {
    const result = await electrobun.rpc!.request.updateAssets({ force: true });
    if (result.updated) await handleAssetUpdate(result.localVersion, false);
    return result;
  }
  throw new Error(`Unknown native method: ${method}`);
};
launcherView.src = "./android_shell/index.html";

document.querySelector("#home")?.addEventListener("click", showHome);
back.addEventListener("click", () => appView?.goBack());
forward.addEventListener("click", () => appView?.goForward());
document.querySelector("#reload")?.addEventListener("click", () => appView?.reload());
zoomOut.addEventListener("click", () => void setZoom(zoomLevel - 0.1));
zoomReset.addEventListener("click", () => void setZoom(1));
zoomIn.addEventListener("click", () => void setZoom(zoomLevel + 0.1));
document.querySelector("#recents")?.addEventListener("click", () => appView?.executeJavascript('document.getElementById("btn-recents")?.click()'));
document.querySelector("#lock")?.addEventListener("click", () => appView?.executeJavascript('document.getElementById("btn-lock")?.click()'));
document.querySelector("#quit-app")?.addEventListener("click", async () => {
  const appId = appIdFromCurrentUrl();
  if (!appId) return toast("No framework app is open");
  try {
    await electrobun.rpc!.request.frameworkRequest({ path: `/api/apps/${appId}/quit`, method: "POST" });
    showHome();
  } catch (error) {
    toast(`Failed to quit ${appId}: ${error instanceof Error ? error.message : String(error)}`);
  }
});
document.querySelector("#minimize-window")?.addEventListener("click", () => void electrobun.rpc!.request.windowControl({ action: "minimize" }));
document.querySelector("#maximize-window")?.addEventListener("click", () => void electrobun.rpc!.request.windowControl({ action: "toggle-maximize" }));
document.querySelector("#close-window")?.addEventListener("click", () => void electrobun.rpc!.request.windowControl({ action: "close" }));

const initialAssetStatus = await electrobun.rpc!.request.getAssetStatus({});
setAssetBadge(initialAssetStatus.localVersion);
await setZoom(zoomLevel);
await updateNavigation();
