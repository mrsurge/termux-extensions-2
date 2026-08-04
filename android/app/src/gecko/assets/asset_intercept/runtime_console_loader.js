(function loadTe2RunProfileConsole() {
  "use strict";

  const devToolsPrefix = "te2-devtools:";
  const runtimePrefix = "te2-run-profile:";

  function markerConfig() {
    const prefix = window.name.startsWith(devToolsPrefix)
      ? devToolsPrefix
      : window.name.startsWith(runtimePrefix)
        ? runtimePrefix
        : "";
    if (!prefix) return null;
    const decoded = JSON.parse(decodeURIComponent(window.name.slice(prefix.length)));
    const surfaceId = String(decoded?.surfaceId || decoded?.targetId || "").trim();
    if (!surfaceId || decoded?.devRuntime !== true) return null;
    return {
      surfaceId,
      frameworkOrigin: String(decoded?.frameworkOrigin || "").trim(),
    };
  }

  function readScript(url) {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send(null);
    if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
      throw new Error(`HTTP ${request.status} while loading ${url}`);
    }
    if (!request.responseText) throw new Error(`${url} is empty`);
    return request.responseText;
  }

  function stripModuleExports(source) {
    return source.replace(
      /\bexport\s+(?=(?:async\s+)?function|class|const|let|var)/g,
      "",
    );
  }

  let marker;
  try {
    marker = markerConfig();
  } catch (_) {
    return;
  }
  if (!marker || window.top === window) return;

  void browser.runtime.sendMessage({
    type: "run_runtime_config",
    surfaceId: marker.surfaceId,
    frameworkOrigin: marker.frameworkOrigin,
  }).then((config) => {
    if (config?.ok !== true) return;
    const origin = new URL(config.frameworkOrigin).origin;
    const socketUrl = `${origin}/static/vendor/socket.io.min.js`;
    const bridgeUrl = `${origin}/static/js/te2_console_bridge.js`;
    window.eval(`${readScript(socketUrl)}\n//# sourceURL=${socketUrl}`);
    window.eval(`${stripModuleExports(readScript(bridgeUrl))}\n//# sourceURL=${bridgeUrl}`);
    window.eval(`globalThis.__te2RunProfileConsoleBridge = initConsoleBridge(${JSON.stringify({
      appId: "file_editor_cm6",
      baseUrl: origin,
      workerLabel: String(config.workerLabel || marker.surfaceId),
      workerIdPrefix: `${String(config.workerIdBase || "rp-prof")}-gkvw`,
      workerOwnerLength: 4,
      uniquePerWindow: true,
    })});`);
  }).catch((error) => {
    console.error("[te2-run-profile-console] injection failed", error);
  });
})();
