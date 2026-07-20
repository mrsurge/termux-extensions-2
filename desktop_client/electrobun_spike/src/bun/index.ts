import { BrowserView, BrowserWindow } from "electrobun/bun";

import { DesktopAssetManager, nativeAssetRedirectRules } from "./assets";
import {
  frameworkOrigin,
  readDesktopSettings,
  resolveTarget,
  validZoom,
  writeDesktopSettings,
  type DesktopShellSettings,
} from "./target";
import type { DesktopShellRpc, FrameworkRequestParams } from "../shared/rpc";

const FRAMEWORK_ROUTE = /^\/api\/apps\/(?:(?:catalog|reload)|(?:[A-Za-z0-9._-]+)\/(?:open|quit))$/;
const assetManager = new DesktopAssetManager();
await assetManager.startServer();

let settings = await readDesktopSettings();
let mainWindow: BrowserWindow;

function apiError(envelope: unknown, fallback: string): Error {
  if (envelope && typeof envelope === "object" && "error" in envelope) {
    const message = String((envelope as { error?: unknown }).error || "").trim();
    if (message) return new Error(message);
  }
  return new Error(fallback);
}

async function frameworkRequest(params: FrameworkRequestParams): Promise<unknown> {
  const method = String(params.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") throw new Error("Unsupported framework request method");
  if (!FRAMEWORK_ROUTE.test(params.path)) throw new Error("Unsupported framework request path");

  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(60_000),
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    init.body = params.body === undefined || params.body === null
      ? ""
      : JSON.stringify(params.body);
  }
  const response = await fetch(`${frameworkOrigin(settings)}${params.path}`, init);
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("Framework returned invalid JSON");
  }
  if (!response.ok) throw apiError(envelope, `Framework returned HTTP ${response.status}`);
  if (!envelope || typeof envelope !== "object") throw new Error("Framework returned an invalid response");
  const body = envelope as { ok?: unknown; data?: unknown };
  if (body.ok === false) throw apiError(envelope, "Framework request failed");
  return body.data;
}

async function frameworkStatus(): Promise<{ online: boolean; frameworkBaseUrl: string; error?: string }> {
  const frameworkBaseUrl = frameworkOrigin(settings);
  try {
    await frameworkRequest({ path: "/api/apps/catalog" });
    return { online: true, frameworkBaseUrl };
  } catch (error) {
    return {
      online: false,
      frameworkBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fwsStatus(): Promise<{ available: boolean; url: string; error?: string }> {
  const url = `${frameworkOrigin(settings)}/fws`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return { available: response.status >= 200 && response.status < 400, url };
  } catch (error) {
    return { available: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

async function saveConnection(
  values: Pick<DesktopShellSettings, "frameworkHost" | "frameworkPort">,
): Promise<DesktopShellSettings> {
  const candidate = {
    ...settings,
    frameworkHost: String(values.frameworkHost || "").trim(),
    frameworkPort: Number(values.frameworkPort),
  };
  // Validate the normalized URL before making it durable.
  frameworkOrigin(candidate);
  settings = await writeDesktopSettings(candidate);
  return settings;
}

const rpc = BrowserView.defineRPC<DesktopShellRpc>({
  maxRequestTime: 180_000,
  handlers: {
    requests: {
      getSettings: () => settings,
      saveSettings: saveConnection,
      saveZoom: async ({ zoomLevel }) => {
        settings = await writeDesktopSettings({ ...settings, zoomLevel: validZoom(zoomLevel) });
        return { zoomLevel: settings.zoomLevel };
      },
      frameworkRequest: async (params) => {
        try {
          return await frameworkRequest(params);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[te2-desktop-framework] ${params.method || "GET"} ${params.path}: ${message}`);
          throw error;
        }
      },
      getFrameworkStatus: frameworkStatus,
      getFwsStatus: fwsStatus,
      getAssetStatus: () => assetManager.status(),
      updateAssets: async ({ force = true }) => {
        const result = await assetManager.updateFromServer(frameworkOrigin(settings), force);
        if (result.updated) rpc.send.assetUpdated({ version: result.localVersion });
        return result;
      },
      getAssetRedirectRules: async () => {
        const status = await assetManager.status();
        return {
          active: status.valid && Boolean(status.serverBaseUrl),
          rules: status.valid && status.serverBaseUrl
            ? nativeAssetRedirectRules(status.serverBaseUrl, status.assetRoot)
            : "",
          version: status.localVersion,
        };
      },
      windowControl: ({ action }) => {
        if (action === "minimize") mainWindow.minimize();
        else if (action === "toggle-maximize") {
          if (mainWindow.isMaximized()) mainWindow.unmaximize();
          else mainWindow.maximize();
          return { maximized: mainWindow.isMaximized() };
        } else if (action === "close") mainWindow.close();
        return {};
      },
      setWindowTitle: ({ title }) => {
        mainWindow.setTitle(String(title || "TE2 Desktop"));
        return {};
      },
    },
    messages: {
      reportDiagnostic: (message) => {
        console.log(`[te2-desktop-diagnostic] ${JSON.stringify(message)}`);
      },
    },
  },
});

mainWindow = new BrowserWindow({
  title: "TE2 Desktop",
  url: "views://mainview/index.html",
  renderer: "cef",
  rpc,
  sandbox: false,
  titleBarStyle: "hidden",
  frame: { x: 80, y: 50, width: 1360, height: 900 },
});

mainWindow.on("close", () => assetManager.stopServer());

if (process.env.TE2_DESKTOP_SPIKE_AUTO_OPEN === "1") {
  void resolveTarget().then(({ targetUrl }) => {
    setTimeout(() => {
      mainWindow.webview.executeJavascript(
        `window.__te2DesktopNavigateApp?.(${JSON.stringify(targetUrl.href)})`,
      );
    }, 1_500);
  }).catch((error) => console.error("[te2-desktop-auto-open]", error));
}

const resizeStressSeconds = Number(process.env.TE2_DESKTOP_RESIZE_STRESS_SECONDS || 0);
if (Number.isFinite(resizeStressSeconds) && resizeStressSeconds > 0) {
  setTimeout(() => {
    const original = mainWindow.getFrame();
    let iteration = 0;
    const timer = setInterval(() => {
      iteration += 1;
      const phase = iteration % 24;
      const width = 960 + Math.abs(12 - phase) * 28;
      const height = 640 + Math.abs(12 - phase) * 16;
      mainWindow.setSize(width, height);
    }, 50);
    setTimeout(() => {
      clearInterval(timer);
      mainWindow.setFrame(original.x, original.y, original.width, original.height);
      console.log(`[te2-desktop-resize] completed ${iteration} resize steps`);
    }, resizeStressSeconds * 1_000);
  }, 5_000);
}

const exitAfterSeconds = Number(process.env.TE2_DESKTOP_EXIT_AFTER_SECONDS || 0);
if (Number.isFinite(exitAfterSeconds) && exitAfterSeconds > 0) {
  setTimeout(() => mainWindow.close(), exitAfterSeconds * 1_000);
}

void assetManager.updateFromServer(frameworkOrigin(settings), false).then((result) => {
  if (result.updated) rpc.send.assetUpdated({ version: result.localVersion });
});
