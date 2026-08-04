(function resolveTe2DevToolsTargetConfig() {
  "use strict";

  const devToolsMarkerPrefix = "te2-devtools:";
  let config = null;

  function decodeMarker() {
    const prefix = devToolsMarkerPrefix;
    if (typeof window.name !== "string" || !window.name.startsWith(prefix)) {
      return null;
    }
    const decoded = JSON.parse(
      decodeURIComponent(window.name.slice(prefix.length)),
    );
    const targetId = String(decoded?.targetId || decoded?.surfaceId || "").trim();
    const surfaceId = String(decoded?.surfaceId || targetId).trim();
    const devTools = decoded?.devTools !== false;
    if (!surfaceId || !devTools) return null;
    return {
      targetId,
      targetLabel:
        typeof decoded?.targetLabel === "string" && decoded.targetLabel.trim()
          ? decoded.targetLabel.trim()
          : targetId,
      surfaceId,
      profileId: String(decoded?.profileId || "").trim(),
      workerLabel: String(decoded?.workerLabel || surfaceId).trim(),
      frameworkOrigin: String(decoded?.frameworkOrigin || "").trim(),
      devTools: true,
      devRuntime: decoded?.devRuntime === true,
      isTopLevel: false,
    };
  }

  if (window.top === window) {
    config = {
      targetId: "framework:main",
      targetLabel: "Code TE2",
      surfaceId: "framework:main",
      profileId: "",
      workerLabel: "framework:main",
      frameworkOrigin: location.origin,
      devTools: true,
      devRuntime: false,
      isTopLevel: true,
    };
  } else {
    try {
      config = decodeMarker();
    } catch (_error) {
      config = null;
    }
  }

  Object.defineProperty(globalThis, "__te2DevToolsTargetConfig", {
    value: config ? Object.freeze(config) : null,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  try {
    void browser.runtime
      .sendNativeMessage("te2_devtools_probe", {
        type: "frame_probe",
        url: location.href,
        windowName:
          typeof window.name === "string" ? window.name.slice(0, 4096) : "",
        isTopLevel: window.top === window,
        readyState: document.readyState,
        targetId: config?.targetId || "",
        targetLabel: config?.targetLabel || "",
        surfaceId: config?.surfaceId || "",
        devTools: config?.devTools === true,
        devRuntime: config?.devRuntime === true,
      })
      .catch(() => {});
  } catch (_error) {
    // Debug probes are best-effort and must not block target initialization.
  }
})();
