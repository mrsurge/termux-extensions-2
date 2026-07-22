import type {
  AppNavigation,
  AssetStatus,
  DesktopBridge,
  DesktopShellSettings,
  NativeRequestMethod,
} from "../shared/contracts";
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from "../shared/contracts";

declare global {
  interface Window {
    te2Desktop: DesktopBridge;
    __te2DesktopNativeRequest?: (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>;
    __te2DesktopNavigateApp?: (url: string) => void;
  }
}

const bridge = window.te2Desktop;
const launcherView = document.querySelector("#launcher-view") as HTMLIFrameElement;
const pageTitle = document.querySelector("#page-title") as HTMLElement;
const assetVersion = document.querySelector("#asset-version") as HTMLElement;
const zoomReset = document.querySelector("#zoom-reset") as HTMLButtonElement;
const zoomOut = document.querySelector("#zoom-out") as HTMLButtonElement;
const zoomIn = document.querySelector("#zoom-in") as HTMLButtonElement;
const back = document.querySelector("#back") as HTMLButtonElement;
const forward = document.querySelector("#forward") as HTMLButtonElement;
const toastElement = document.querySelector("#native-toast") as HTMLElement;

let settings = await bridge.request("get_settings") as DesktopShellSettings;
let browserFrameworkOrigin = (
  await bridge.request("get_browser_framework_origin") as { origin: string }
).origin;
let currentUrl: URL | null = null;
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

function renderZoom(): void {
  zoomReset.textContent = `${Math.round(zoomLevel * 100)}%`;
  zoomOut.disabled = zoomLevel <= MIN_ZOOM_LEVEL;
  zoomIn.disabled = zoomLevel >= MAX_ZOOM_LEVEL;
}

async function setZoom(value: number): Promise<void> {
  const result = await bridge.request("view_action", {
    action: "set_zoom",
    zoomLevel: normalizeZoom(value),
  }) as { zoomLevel: number };
  zoomLevel = result.zoomLevel;
  renderZoom();
}

function setNavigation(canGoBack: boolean, canGoForward: boolean): void {
  back.disabled = !currentUrl || !canGoBack;
  forward.disabled = !currentUrl || !canGoForward;
}

function appIdFromCurrentUrl(): string | null {
  if (!currentUrl || currentUrl.origin !== browserFrameworkOrigin) return null;
  const match = currentUrl.pathname.match(/^\/app\/([A-Za-z0-9._-]+)(?:\/|$)/);
  const appId = match?.[1] || (
    currentUrl.pathname === "/app" ? currentUrl.searchParams.get("app_id") : null
  );
  return appId && /^[A-Za-z0-9._-]+$/.test(appId) ? appId : null;
}

async function showApp(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  url.searchParams.set("gv_native", "1");
  currentUrl = url;
  launcherView.hidden = true;
  document.body.dataset.appOpen = "true";
  setNavigation(false, false);
  try {
    await bridge.request("navigate_app", { url: url.href });
  } catch (error) {
    showHome();
    throw error;
  }
}

function showHome(): void {
  currentUrl = null;
  launcherView.hidden = false;
  launcherView.src = "./android_shell/index.html";
  delete document.body.dataset.appOpen;
  pageTitle.textContent = "TE2 Desktop";
  setNavigation(false, false);
  void bridge.request("view_action", { action: "home" });
  void bridge.request("set_window_title", { title: "TE2 Desktop" });
}

function handleNavigation(navigation: AppNavigation): void {
  try {
    currentUrl = new URL(navigation.url);
    if (currentUrl.origin === browserFrameworkOrigin && currentUrl.pathname === "/") {
      showHome();
      return;
    }
  } catch {
    return;
  }
  launcherView.hidden = true;
  document.body.dataset.appOpen = "true";
  pageTitle.textContent = navigation.title || "TE2 Desktop";
  setNavigation(navigation.canGoBack, navigation.canGoForward);
}

window.__te2DesktopNativeRequest = async (method, params = {}) => {
  const result = await bridge.request(method as NativeRequestMethod, params);
  if (method === "save_settings") {
    const saved = result as {
      settings: DesktopShellSettings;
      browserFrameworkOrigin: string;
    };
    settings = saved.settings;
    browserFrameworkOrigin = saved.browserFrameworkOrigin;
  }
  return result;
};

window.__te2DesktopNavigateApp = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "te2-desktop:") {
      launcherView.src = url.href;
      launcherView.hidden = false;
      return;
    }
    void showApp(url.href).catch((error) => {
      toast(error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
};

bridge.onAppNavigation(handleNavigation);
bridge.onAssetUpdated((version) => {
  setAssetBadge(version);
  toast(`Desktop assets updated to v${version || "unknown"}`);
});
bridge.onSteer((action) => {
  if (action === "home") showHome();
});

document.querySelector("#home")?.addEventListener("click", showHome);
back.addEventListener("click", () => void bridge.request("view_action", { action: "back" }));
forward.addEventListener("click", () => void bridge.request("view_action", { action: "forward" }));
document.querySelector("#reload")?.addEventListener(
  "click",
  () => void bridge.request("view_action", { action: "reload" }),
);
zoomOut.addEventListener("click", () => void setZoom(zoomLevel - 0.1));
zoomReset.addEventListener("click", () => void setZoom(1));
zoomIn.addEventListener("click", () => void setZoom(zoomLevel + 0.1));
document.querySelector("#recents")?.addEventListener(
  "click",
  () => void bridge.request("view_action", { action: "recents" }),
);
document.querySelector("#lock")?.addEventListener(
  "click",
  () => void bridge.request("view_action", { action: "lock" }),
);
document.querySelector("#quit-app")?.addEventListener("click", async () => {
  const appId = appIdFromCurrentUrl();
  if (!appId) return toast("No framework app is open");
  try {
    await bridge.request("framework_request", {
      path: `/api/apps/${appId}/quit`,
      method: "POST",
    });
    showHome();
  } catch (error) {
    toast(`Failed to quit ${appId}: ${error instanceof Error ? error.message : String(error)}`);
  }
});
document.querySelector("#minimize-window")?.addEventListener(
  "click",
  () => void bridge.request("window_control", { action: "minimize" }),
);
document.querySelector("#maximize-window")?.addEventListener(
  "click",
  () => void bridge.request("window_control", { action: "toggle_maximize" }),
);
document.querySelector("#close-window")?.addEventListener(
  "click",
  () => void bridge.request("window_control", { action: "close" }),
);

launcherView.src = "./android_shell/index.html";
const initialAssetStatus = await bridge.request("get_asset_status") as AssetStatus;
setAssetBadge(initialAssetStatus.localVersion);
renderZoom();
setNavigation(false, false);
