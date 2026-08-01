(function resolveTe2DevToolsTargetConfig() {
  "use strict";

  const markerPrefix = "te2-devtools:";
  let config = null;

  if (window.top === window) {
    config = {
      targetId: "framework:main",
      targetLabel: "Code TE2",
      isTopLevel: true,
    };
  } else if (typeof window.name === "string" && window.name.startsWith(markerPrefix)) {
    try {
      const decoded = JSON.parse(
        decodeURIComponent(window.name.slice(markerPrefix.length)),
      );
      if (typeof decoded?.targetId === "string" && decoded.targetId.trim()) {
        config = {
          targetId: decoded.targetId.trim(),
          targetLabel:
            typeof decoded.targetLabel === "string" && decoded.targetLabel.trim()
              ? decoded.targetLabel.trim()
              : decoded.targetId.trim(),
          isTopLevel: false,
        };
      }
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
      })
      .catch(() => {});
  } catch (_error) {
    // Debug probes are best-effort and must not block target initialization.
  }
})();
