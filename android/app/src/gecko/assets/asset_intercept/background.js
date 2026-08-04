/* asset_intercept — background.js
 *
 * Listens for a native message with the local asset server port,
 * then intercepts matching HTTP requests and redirects them to the
 * local asset server (which serves from filesDir/editor_static/).
 */

let assetServerPort = 0;
let enabled = false;
let nativePort = null;
let reconnectTimer = 0;
let frameworkBaseUrl = "";
const pendingRunTargets = new Map();
const devRuntimeOriginsBySurface = new Map();
const devRuntimeLabelsBySurface = new Map();
const devRuntimeWorkerIdBasesBySurface = new Map();
let devRuntimeOrigins = new Set();

function runtimeMetadata(route) {
  const runtime = route && typeof route.te2Runtime === "object"
    ? route.te2Runtime
    : null;
  const surfaceId = String(runtime?.surfaceId || "").trim();
  if (!surfaceId || runtime?.devRuntime !== true) return null;
  return {
    surfaceId,
    workerIdBase: String(runtime.workerIdBase || "rp-prof").trim() || "rp-prof",
    workerLabel: String(runtime.workerLabel || surfaceId).trim() || surfaceId,
  };
}

function routeEntries(route) {
  if (route?.dto === "RunTargetRouteSet") {
    return [route.primary, ...(Array.isArray(route.additional) ? route.additional : [])]
      .filter((entry) => entry && typeof entry === "object");
  }
  return route && typeof route === "object" ? [route] : [];
}

function routeOrigin(entry, mode) {
  const original = new URL(String(entry.originalUrl || ""));
  if (mode === "tunnel") {
    original.hostname = "127.0.0.1";
    original.port = String(Number(entry.preferredPort));
  }
  return original.origin;
}

function rebuildDevRuntimeOrigins() {
  const next = new Set();
  for (const origins of devRuntimeOriginsBySurface.values()) {
    for (const origin of origins) next.add(origin);
  }
  devRuntimeOrigins = next;
}

function registerDevRuntimePolicy(route, result) {
  const runtime = runtimeMetadata(route);
  if (!runtime || result?.ok !== true) return;
  const origins = new Set();
  for (const entry of routeEntries(route)) {
    try {
      origins.add(routeOrigin(entry, result.mode));
    } catch (_) {}
  }
  try {
    origins.add(new URL(String(result.url || "")).origin);
  } catch (_) {}
  if (origins.size === 0) return;
  devRuntimeOriginsBySurface.set(runtime.surfaceId, origins);
  devRuntimeLabelsBySurface.set(runtime.surfaceId, runtime.workerLabel);
  devRuntimeWorkerIdBasesBySurface.set(runtime.surfaceId, runtime.workerIdBase);
  rebuildDevRuntimeOrigins();
}

function registerDirectDevRuntimePolicy(runtime, url) {
  const surfaceId = String(runtime?.surfaceId || "").trim();
  if (!surfaceId || runtime?.devRuntime !== true) return false;
  try {
    devRuntimeOriginsBySurface.set(surfaceId, new Set([new URL(String(url || "")).origin]));
    devRuntimeLabelsBySurface.set(
      surfaceId,
      String(runtime.workerLabel || surfaceId).trim() || surfaceId,
    );
    devRuntimeWorkerIdBasesBySurface.set(
      surfaceId,
      String(runtime.workerIdBase || "rp-prof").trim() || "rp-prof",
    );
    rebuildDevRuntimeOrigins();
    return true;
  } catch (_) {
    return false;
  }
}

function releaseDevRuntimePolicy(surfaceId) {
  const normalized = String(surfaceId || "").trim();
  devRuntimeLabelsBySurface.delete(normalized);
  devRuntimeWorkerIdBasesBySurface.delete(normalized);
  if (!devRuntimeOriginsBySurface.delete(normalized)) return;
  rebuildDevRuntimeOrigins();
}

function clearDevRuntimePolicies() {
  devRuntimeOriginsBySurface.clear();
  devRuntimeLabelsBySurface.clear();
  devRuntimeWorkerIdBasesBySurface.clear();
  devRuntimeOrigins = new Set();
}

function isDevRuntimeRequest(details) {
  if (String(details.type || "").toLowerCase() === "websocket") return false;
  try {
    return devRuntimeOrigins.has(new URL(details.url).origin);
  } catch (_) {
    return false;
  }
}

function replaceHeader(headers, name, value) {
  const lower = name.toLowerCase();
  const filtered = (Array.isArray(headers) ? headers : [])
    .filter((header) => String(header?.name || "").toLowerCase() !== lower);
  filtered.push({ name, value });
  return filtered;
}

// Prefixes backed by complete OTA directory entries. Keep API prefixes limited
// to immutable static trees so dynamic backend routes always stay on TE2.
const LOCAL_PREFIXES = [
  "/static/vendor/codicons/",
  "/static/vendor/seti-icons/",
  "/static/vendor/es-module-shims/",
  "/static/vendor/codemirror.1/",
  "/static/vendor/xterm/",
  "/static/vendor/ws/",
  "/static/fonts/",
  "/static/js/",
  "/extensions/",
  "/apps/file_editor_cm6/static/icons/",
  "/apps/file_editor_cm6/static/vendor/monaco-touch-selection/",
  "/apps/file_editor_cm6/vendor/android-terminalapp-assets-js/",
  "/api/app/file_editor_cm6/static/vendor/monaco-touch-selection/",
  "/api/app/file_editor_cm6/ui/monaco_editor/textmate/",
  "/api/app/file_editor_cm6/ui/monaco_editor/themes/",
  "/api/app/file_editor_cm6/ui/monaco_vscode/lang/workers/"
];

const LOCAL_FILES = new Set([
  "/static/icon.png",
  "/static/move.png",
  "/static/manifest.webmanifest",
  "/static/bookmarks.json",
  "/static/vendor/socket.io.min.js",
  "/static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.css",
  "/static/vendor/monaco-editor-core/te2-lang/bootstrap/codicon-LN6W7LCM.ttf",
  "/static/vendor/monaco-editor-core/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
  "/apps/file_editor_cm6/template.html",
  "/apps/by-id/file_editor_cm6/template.html",
  "/apps/file_editor_cm6/static/dist/host.js",
  "/apps/by-id/file_editor_cm6/static/dist/host.js",
  "/apps/file_editor_cm6/static/dist/host.css",
  "/apps/file_editor_cm6/static/dist/explorer.css",
  "/apps/file_editor_cm6/static/dist/explorer-highlight-github.css",
  "/apps/file_editor_cm6/static/dist/explorer-search-widget.css",
  "/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js",
  "/api/app/file_editor_cm6/ui/monaco_vscode/lang/bootstrap/monaco.bootstrap.bundle.css",
  "/api/app/file_editor_cm6/ui/monaco_vscode/esm/vs/editor/common/services/editorWebWorkerMain.bundle.js",
  "/apps/file_editor_cm6/monaco_editor/vscode_build_src/out/breadcrumbsWidget.css",
  "/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditorController.css",
  "/apps/file_editor_cm6/monaco_editor/vscode_chat_editing_vendor/upstream/media/chatEditingEditorOverlay.css"
]);

function localPathFor(urlPath) {
  if (!LOCAL_FILES.has(urlPath) && !LOCAL_PREFIXES.some((prefix) => urlPath.startsWith(prefix))) {
    return null;
  }
  if (urlPath === "/apps/by-id/file_editor_cm6/template.html") {
    return "/apps/file_editor_cm6/template.html";
  }
  if (urlPath.startsWith("/apps/by-id/file_editor_cm6/static/")) {
    return "/apps/file_editor_cm6/static/" + urlPath.slice("/apps/by-id/file_editor_cm6/static/".length);
  }
  if (urlPath.startsWith("/api/app/file_editor_cm6/static/")) {
    return "/apps/file_editor_cm6/static/" + urlPath.slice("/api/app/file_editor_cm6/static/".length);
  }
  if (urlPath.startsWith("/api/app/file_editor_cm6/ui/monaco_vscode/lang/")) {
    return "/static/vendor/monaco-editor-core/te2-lang/" + urlPath.slice("/api/app/file_editor_cm6/ui/monaco_vscode/lang/".length);
  }
  if (urlPath.startsWith("/api/app/file_editor_cm6/ui/monaco_vscode/esm/")) {
    return "/static/vendor/monaco-editor-core/esm/" + urlPath.slice("/api/app/file_editor_cm6/ui/monaco_vscode/esm/".length);
  }
  if (urlPath.startsWith("/apps/file_editor_cm6/monaco_editor/vscode_build_src/")) {
    return "/api/app/file_editor_cm6/ui/monaco_editor/vscode_build_src/" + urlPath.slice("/apps/file_editor_cm6/monaco_editor/vscode_build_src/".length);
  }
  return urlPath;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    try {
      // Redirecting a document changes its origin to LocalAssetServer. Keep
      // framework pages on TE2 so relative APIs and socket URLs stay valid.
      if (details.type === "main_frame") return {};

      const url = new URL(details.url);
      const isLocalAssetRequest =
        (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
        Number(url.port) === assetServerPort;
      if (isLocalAssetRequest) return {};

      const path = url.pathname;
      const localPath = localPathFor(path);
      if (!localPath) return {};
      if (!enabled || assetServerPort === 0) {
        console.error(`[asset_intercept] blocked network fallback for ${path}`);
        return { cancel: true };
      }
      let search = url.search || "";
      const redirectUrl = `http://127.0.0.1:${assetServerPort}${localPath}${search}`;
      console.debug(`[asset_intercept] ${path} -> ${localPath}`);
      return { redirectUrl };
    } catch (e) {
      return {};
    }
  },
  // Framework pages may be loaded from localhost, LAN, or Tailscale. The path
  // allowlist above remains the authority for what can be redirected locally.
  { urls: ["<all_urls>"] },
  ["blocking"]
);

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isDevRuntimeRequest(details)) return {};
    let requestHeaders = replaceHeader(details.requestHeaders, "Cache-Control", "no-cache");
    requestHeaders = replaceHeader(requestHeaders, "Pragma", "no-cache");
    return { requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"],
);

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isDevRuntimeRequest(details)) return {};
    let responseHeaders = replaceHeader(
      details.responseHeaders,
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );
    responseHeaders = replaceHeader(responseHeaders, "Pragma", "no-cache");
    responseHeaders = replaceHeader(responseHeaders, "Expires", "0");
    return { responseHeaders };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"],
);

function scheduleNativeReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = 0;
    connectNativeBridge();
  }, 250);
}

function frameworkOrigin() {
  try {
    return new URL(frameworkBaseUrl).origin;
  } catch (_) {
    return "";
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "run_runtime_config") {
    const surfaceId = String(message.surfaceId || "").trim();
    const senderOrigin = (() => {
      try { return new URL(sender.url || "").origin; } catch (_) { return ""; }
    })();
    const configuredFrameworkOrigin = frameworkOrigin();
    const requestedFrameworkOrigin = (() => {
      try { return new URL(String(message.frameworkOrigin || "")).origin; } catch (_) { return ""; }
    })();
    const origins = devRuntimeOriginsBySurface.get(surfaceId);
    if (
      !surfaceId ||
      !origins?.has(senderOrigin) ||
      !configuredFrameworkOrigin ||
      requestedFrameworkOrigin !== configuredFrameworkOrigin
    ) {
      return Promise.resolve({ ok: false, error: "Run Profile runtime marker is not trusted" });
    }
    return Promise.resolve({
      ok: true,
      frameworkOrigin: configuredFrameworkOrigin,
      workerIdBase: devRuntimeWorkerIdBasesBySurface.get(surfaceId) || "rp-prof",
      workerLabel: devRuntimeLabelsBySurface.get(surfaceId) || surfaceId,
    });
  }
  if (
    !message ||
    !["run_target_resolve", "run_target_register", "run_target_release"].includes(message.type)
  ) {
    return undefined;
  }
  const senderOrigin = (() => {
    try { return new URL(sender.url || "").origin; } catch (_) { return ""; }
  })();
  if (sender.frameId !== 0 || senderOrigin !== frameworkOrigin()) {
    return Promise.resolve({ ok: false, error: "Run target request origin is not trusted" });
  }
  if (message.type === "run_target_release") {
    releaseDevRuntimePolicy(message.surfaceId);
    return Promise.resolve({ ok: true });
  }
  if (message.type === "run_target_register") {
    return Promise.resolve(
      registerDirectDevRuntimePolicy(message.runtime, message.url)
        ? { ok: true }
        : { ok: false, error: "Run Profile runtime registration is invalid" },
    );
  }
  if (!nativePort) {
    return Promise.resolve({ ok: false, error: "Native run target bridge is unavailable" });
  }
  const requestId = String(message.requestId || "");
  if (!requestId || pendingRunTargets.has(requestId)) {
    return Promise.resolve({ ok: false, error: "Run target request id is invalid" });
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRunTargets.delete(requestId);
      resolve({ ok: false, error: "Native run target request timed out" });
    }, 5000);
    pendingRunTargets.set(requestId, { resolve, timeout, route: message.route });
    try {
      nativePort.postMessage({
        type: "run_target_resolve",
        requestId,
        route: message.route,
        pageOrigin: message.pageOrigin,
      });
    } catch (error) {
      pendingRunTargets.delete(requestId);
      clearTimeout(timeout);
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

function rejectPendingRunTargets(error) {
  for (const pending of pendingRunTargets.values()) {
    clearTimeout(pending.timeout);
    pending.resolve({ ok: false, error });
  }
  pendingRunTargets.clear();
}

// Static interception stays disabled until Kotlin confirms the local server port.
function connectNativeBridge() {
  try {
    const port = browser.runtime.connectNative("browser");
    nativePort = port;
    port.onMessage.addListener((message) => {
      if (message && message.type === "set_asset_port") {
        const previousFrameworkBaseUrl = frameworkBaseUrl;
        assetServerPort = message.port;
        frameworkBaseUrl = String(message.frameworkBaseUrl || "");
        if (previousFrameworkBaseUrl && previousFrameworkBaseUrl !== frameworkBaseUrl) {
          clearDevRuntimePolicies();
        }
        enabled = message.port > 0;
        console.log(`[asset_intercept] Port set to ${assetServerPort}, enabled=${enabled}`);
        port.postMessage({
          type: "asset_intercept_ready",
          port: assetServerPort,
        });
      } else if (message && message.type === "run_target_resolve_result") {
        const requestId = String(message.requestId || "");
        const pending = pendingRunTargets.get(requestId);
        if (pending) {
          pendingRunTargets.delete(requestId);
          clearTimeout(pending.timeout);
          registerDevRuntimePolicy(pending.route, message);
          pending.resolve(message);
        }
      }
    });
    port.onDisconnect.addListener(() => {
      if (nativePort === port) nativePort = null;
      assetServerPort = 0;
      enabled = false;
      frameworkBaseUrl = "";
      clearDevRuntimePolicies();
      rejectPendingRunTargets("Native run target bridge disconnected");
      scheduleNativeReconnect();
    });
  } catch (error) {
    assetServerPort = 0;
    enabled = false;
    frameworkBaseUrl = "";
    clearDevRuntimePolicies();
    rejectPendingRunTargets("Native run target bridge is unavailable");
    scheduleNativeReconnect();
  }
}

connectNativeBridge();
