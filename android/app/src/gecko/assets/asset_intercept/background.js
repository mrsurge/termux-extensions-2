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

// Prefixes backed by complete OTA directory entries. Keep API prefixes limited
// to immutable static trees so dynamic backend routes always stay on TE2.
const LOCAL_PREFIXES = [
  "/static/vendor/codicons/",
  "/static/vendor/seti-icons/",
  "/static/vendor/es-module-shims/",
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

function scheduleNativeReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = 0;
    connectNativeBridge();
  }, 250);
}

// Static interception stays disabled until Kotlin confirms the local server port.
function connectNativeBridge() {
  try {
    const port = browser.runtime.connectNative("browser");
    nativePort = port;
    port.onMessage.addListener((message) => {
      if (message && message.type === "set_asset_port") {
        assetServerPort = message.port;
        enabled = message.port > 0;
        console.log(`[asset_intercept] Port set to ${assetServerPort}, enabled=${enabled}`);
        port.postMessage({
          type: "asset_intercept_ready",
          port: assetServerPort,
        });
      }
    });
    port.onDisconnect.addListener(() => {
      if (nativePort === port) nativePort = null;
      assetServerPort = 0;
      enabled = false;
      scheduleNativeReconnect();
    });
  } catch (error) {
    assetServerPort = 0;
    enabled = false;
    scheduleNativeReconnect();
  }
}

connectNativeBridge();
