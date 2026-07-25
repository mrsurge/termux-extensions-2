const DEFAULT_SETTINGS = {
  frameworkHost: "127.0.0.1",
  frameworkPort: 8089,
};

const LOCAL_SETTINGS_APP = {
  id: "settings",
  name: "Settings",
  description: "Desktop connection and framework options",
  icon_text: "S",
  local: true,
  running: true,
};

const nativeBridge = globalThis.webkit?.messageHandlers?.native;
const parentBridge = (() => {
  try {
    return globalThis.parent !== globalThis &&
      typeof globalThis.parent.__te2DesktopNativeRequest === "function"
      ? globalThis.parent.__te2DesktopNativeRequest
      : null;
  } catch {
    return null;
  }
})();

if (!nativeBridge && !parentBridge) {
  throw new Error("Desktop native bridge is unavailable");
}

let nextRequestId = 0;
let cachedSettings = null;
let cachedBrowserFrameworkOrigin = null;
const pendingRequests = new Map();

globalThis.__te2NativeReply = (id, ok, value) => {
  const key = String(id);
  const request = pendingRequests.get(key);
  if (!request) return;

  pendingRequests.delete(key);
  if (ok) {
    request.resolve(value);
  } else {
    request.reject(new Error(String(value || "Native request failed")));
  }
};

function nativeRequest(method, params = {}) {
  if (parentBridge) return parentBridge(method, params);
  const id = String(++nextRequestId);

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      nativeBridge.postMessage(JSON.stringify({ id, method, params }));
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
  });
}

function normalizeSettings(settings = {}) {
  const frameworkHost =
    String(settings.frameworkHost || "").trim() ||
    DEFAULT_SETTINGS.frameworkHost;
  const parsedPort = Number(settings.frameworkPort);
  const frameworkPort =
    Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
      ? parsedPort
      : DEFAULT_SETTINGS.frameworkPort;

  return { frameworkHost, frameworkPort };
}

export async function getSettings() {
  if (!cachedSettings) {
    cachedSettings = normalizeSettings(await nativeRequest("get_settings"));
  }
  return { ...cachedSettings };
}

export async function saveSettings(settings) {
  const result = await nativeRequest(
    "save_settings",
    normalizeSettings(settings),
  );
  const nextSettings = result?.settings || result;
  cachedSettings = normalizeSettings(nextSettings);
  cachedBrowserFrameworkOrigin = result?.browserFrameworkOrigin || null;
  return {
    ...cachedSettings,
    connectionChanged: Boolean(result?.connectionChanged),
  };
}

function getFrameworkOrigin(settings) {
  const host = settings.frameworkHost;
  const url = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `http://${host}`,
  );
  url.port = String(settings.frameworkPort);
  return url.origin;
}

async function getBrowserFrameworkOrigin(settings) {
  if (cachedBrowserFrameworkOrigin) return cachedBrowserFrameworkOrigin;
  try {
    const result = await nativeRequest("get_browser_framework_origin");
    const origin = new URL(String(result?.origin || "")).origin;
    if (!/^https?:$/i.test(new URL(origin).protocol)) {
      throw new Error("Browser framework origin must use HTTP or HTTPS");
    }
    cachedBrowserFrameworkOrigin = origin;
  } catch {
    // The retired WebKitGTK reference shell does not expose the relay method.
    cachedBrowserFrameworkOrigin = getFrameworkOrigin(settings);
  }
  return cachedBrowserFrameworkOrigin;
}

function absoluteFrameworkUrl(origin, rawUrl) {
  return new URL(String(rawUrl || ""), `${origin}/`).href;
}

function projectFrameworkUrl(configuredOrigin, browserOrigin, rawUrl) {
  const target = new URL(String(rawUrl || ""), `${configuredOrigin}/`);
  if (target.origin !== configuredOrigin || browserOrigin === configuredOrigin) {
    return target.href;
  }
  return absoluteFrameworkUrl(
    browserOrigin,
    `${target.pathname}${target.search}${target.hash}`,
  );
}

function normalizeAppAssets(app, configuredOrigin, browserOrigin) {
  const normalized = { ...app };
  const rawAssetBase = String(normalized.asset_base_url || "").trim();
  if (rawAssetBase) {
    normalized.asset_base_url = projectFrameworkUrl(
      configuredOrigin,
      browserOrigin,
      rawAssetBase,
    );
  }

  const iconSource = String(normalized.icon_src || "").trim();
  if (iconSource) {
    if (/^https?:\/\//i.test(iconSource)) {
      normalized.icon_src = projectFrameworkUrl(
        configuredOrigin,
        browserOrigin,
        iconSource,
      );
    } else if (iconSource.startsWith("/")) {
      normalized.icon_src = absoluteFrameworkUrl(browserOrigin, iconSource);
    } else if (rawAssetBase) {
      normalized.icon_src =
        `${String(normalized.asset_base_url).replace(/\/$/, "")}/` +
        iconSource.replace(/^\//, "");
    } else {
      normalized.icon_src = absoluteFrameworkUrl(browserOrigin, iconSource);
    }
  }
  return normalized;
}

function frameworkRequest(path, { method = "GET", body } = {}) {
  const params = { path, method };
  if (body !== undefined && body !== null) params.body = body;
  return nativeRequest("framework_request", params);
}

async function getLocalApps() {
  const settings = await getSettings();
  return {
    apps: [{ ...LOCAL_SETTINGS_APP }],
    online: false,
    frameworkBaseUrl: getFrameworkOrigin(settings),
  };
}

async function getApps() {
  const local = await getLocalApps();
  const settings = await getSettings();
  const frameworkBaseUrl = local.frameworkBaseUrl;
  const browserOrigin = await getBrowserFrameworkOrigin(settings);
  const apps = local.apps;

  try {
    const catalog = await frameworkRequest("/api/apps/catalog");
    for (const app of Array.isArray(catalog) ? catalog : []) {
      if (app?.id === LOCAL_SETTINGS_APP.id) continue;
      apps.push(normalizeAppAssets(app, frameworkBaseUrl, browserOrigin));
    }
    return { apps, online: true, frameworkBaseUrl };
  } catch (error) {
    return {
      apps,
      online: false,
      frameworkBaseUrl,
      error: error?.message || "Framework unavailable",
    };
  }
}

async function reloadApps() {
  await frameworkRequest("/api/apps/reload", { method: "POST" });
  return getApps();
}

async function openApp(appId) {
  if (appId === LOCAL_SETTINGS_APP.id) {
    return { url: new URL("./settings.html", window.location.href).href };
  }

  const settings = await getSettings();
  const browserOrigin = await getBrowserFrameworkOrigin(settings);
  const result = await frameworkRequest(
    `/api/apps/${encodeURIComponent(appId)}/open`,
    { method: "POST", body: { params: {} } },
  );
  const appUrl = new URL(
    projectFrameworkUrl(
      getFrameworkOrigin(settings),
      browserOrigin,
      result?.url || `/app/${appId}`,
    ),
  );
  // Native wrappers own their static asset layer, so the framework's PWA
  // worker must not race or mask the desktop WebKit interceptor.
  appUrl.searchParams.set("gv_native", "1");
  return {
    ...(result || {}),
    url: appUrl.href,
  };
}

function quitApp(appId) {
  return frameworkRequest(`/api/apps/${encodeURIComponent(appId)}/quit`, {
    method: "POST",
  });
}

async function getFrameworkStatus() {
  const settings = await getSettings();
  const frameworkBaseUrl = getFrameworkOrigin(settings);
  try {
    await frameworkRequest("/api/apps/catalog");
    return { online: true, frameworkBaseUrl };
  } catch (error) {
    return {
      online: false,
      frameworkBaseUrl,
      error: error?.message || "Framework unavailable",
    };
  }
}

let toastTimer = 0;

export function toast(message) {
  const element = document.querySelector("#toast");
  if (!element) return;

  element.textContent = String(message || "");
  element.dataset.visible = "true";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.dataset.visible = "false";
  }, 2800);
}

export const desktopShellHost = {
  getLocalApps,
  getApps,
  reloadApps,
  openApp,
  quitApp,
  getSettings,
  saveSettings,
  getFrameworkStatus,
  getFwsStatus: () => nativeRequest("get_fws_status"),
  getAssetStatus: () => nativeRequest("get_asset_status"),
  updateAssets: () => nativeRequest("update_assets"),
  navigate: (url) => {
    try {
      if (
        globalThis.parent !== globalThis &&
        typeof globalThis.parent.__te2DesktopNavigateApp === "function"
      ) {
        globalThis.parent.__te2DesktopNavigateApp(String(url));
        return;
      }
    } catch {
      // The WebKitGTK shell uses ordinary top-level navigation.
    }
    window.location.assign(String(url));
  },
  toast,
};
