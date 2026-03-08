/* asset_intercept — background.js
 *
 * Listens for a native message with the local asset server port,
 * then intercepts matching HTTP requests and redirects them to the
 * local asset server (which serves from filesDir/editor_static/).
 */

let assetServerPort = 0;
let enabled = false;

// URL path prefixes that map directly to the local asset server.
// The local server mirrors the same path structure.
const INTERCEPT_PREFIXES = [
  "/static/vendor/codicons/",
  "/static/vendor/seti-icons/",
  "/static/vendor/es-module-shims/",
  "/static/vendor/xterm/",
  "/static/vendor/ws/",
  "/static/vendor/monaco-editor-core/te2-lang/bootstrap/",
  "/static/vendor/monaco-editor-core/te2-lang/basic-languages/",
  "/static/vendor/monaco-editor-core/te2-lang/language/",
  "/static/vendor/monaco-editor-core/esm/",
  "/static/fonts/",
  "/static/js/",
  "/apps/file_editor_cm6/static/",
  "/api/app/file_editor_cm6/ui/monaco_editor/",
  "/api/app/file_editor_cm6/ui/monaco_vscode/lang/",
  "/api/app/file_editor_cm6/ui/monaco_vscode/esm/",
  "/apps/file_editor_cm6/monaco_editor/vscode_build_src/"
];

// Exact file matches at /static/ root
const INTERCEPT_FILES = [
  "/static/icon.png",
  "/static/move.png",
  "/static/manifest.webmanifest",
  "/static/bookmarks.json",
  "/static/vendor/socket.io.min.js"
];

// te2-lang chunk files (top-level in te2-lang dir)
const TE2_LANG_CHUNK_RE = /^\/static\/vendor\/monaco-editor-core\/te2-lang\/chunk-[A-Z0-9]+\.js$/;

// Exclude workers — they stay server-fetched
const WORKER_RE = /\/te2-lang\/workers\//;

// /api/app/file_editor_cm6/static/ maps to /apps/file_editor_cm6/static/ locally
function mapPath(urlPath) {
  if (urlPath.startsWith("/api/app/file_editor_cm6/static/")) {
    return "/apps/file_editor_cm6/static/" + urlPath.slice("/api/app/file_editor_cm6/static/".length);
  }
  // iframe HTML page
  if (urlPath === "/api/app/file_editor_cm6/ui/nc") {
    return "/api/app/file_editor_cm6/ui/nc.html";
  }
  // app shell for file_editor_cm6
  if (urlPath === "/app/file_editor_cm6") {
    return "/app_shell_file_editor_cm6.html";
  }
  // index page
  if (urlPath === "/") {
    return "/index.html";
  }
  return urlPath;
}

function shouldIntercept(urlPath) {
  if (WORKER_RE.test(urlPath)) return false;
  if (TE2_LANG_CHUNK_RE.test(urlPath)) return true;
  // HTML pages
  if (urlPath === "/" || urlPath === "/app/file_editor_cm6" || urlPath === "/api/app/file_editor_cm6/ui/nc") return true;
  for (const f of INTERCEPT_FILES) {
    if (urlPath === f) return true;
  }
  for (const prefix of INTERCEPT_PREFIXES) {
    if (urlPath.startsWith(prefix)) return true;
  }
  return false;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!enabled || assetServerPort === 0) return {};

    try {
      const url = new URL(details.url);
      // Only intercept requests to the framework server on localhost
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return {};

      const path = url.pathname;
      if (!shouldIntercept(path)) return {};

      const localPath = mapPath(path);
      const redirectUrl = `http://127.0.0.1:${assetServerPort}${localPath}${url.search || ""}`;
      return { redirectUrl };
    } catch (e) {
      return {};
    }
  },
  { urls: ["*://127.0.0.1/*", "*://localhost/*"] },
  ["blocking"]
);

// Receive port from native app via runtime messaging
browser.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === "set_asset_port") {
    assetServerPort = message.port;
    enabled = message.port > 0;
    console.log(`[asset_intercept] Port set to ${assetServerPort}, enabled=${enabled}`);
  }
});

// Also support native messaging from the Kotlin side
try {
  const nativePort = browser.runtime.connectNative("browser");
  nativePort.onMessage.addListener((message) => {
    if (message && message.type === "set_asset_port") {
      assetServerPort = message.port;
      enabled = message.port > 0;
      console.log(`[asset_intercept] (native) Port set to ${assetServerPort}, enabled=${enabled}`);
    }
  });
} catch (e) {
  // Native messaging may not be available yet
}
