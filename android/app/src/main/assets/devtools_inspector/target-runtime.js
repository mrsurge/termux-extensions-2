(function installTe2DevToolsTargetRuntime() {
  "use strict";

  if (window.__te2DevToolsTarget) return;

  const inboundEvent = "te2-devtools-target-inbound";
  const outboundEvent = "te2-devtools-target-outbound";
  const chobitsu = window.chobitsu;

  if (!chobitsu || typeof chobitsu.sendRawMessage !== "function") {
    throw new Error("Chobitsu target runtime unavailable");
  }

  function sendToInspector(message) {
    document.dispatchEvent(
      new CustomEvent(outboundEvent, { detail: String(message) }),
    );
  }

  function sendSyntheticEvent(method, params) {
    sendToInspector(JSON.stringify({ method, params }));
  }

  function publishDocumentState(method) {
    if (method === "DOM.enable") {
      sendSyntheticEvent("DOM.documentUpdated", {});
      return;
    }
    if (method !== "Page.enable") return;

    sendSyntheticEvent("Page.frameNavigated", {
      frame: {
        id: "1",
        mimeType: document.contentType || "text/html",
        securityOrigin: location.origin,
        url: location.href,
      },
      type: "Navigation",
    });
    sendSyntheticEvent("Page.loadEventFired", {
      timestamp: Date.now() / 1000,
    });
  }

  chobitsu.setOnMessage(sendToInspector);
  document.addEventListener(inboundEvent, async (event) => {
    if (typeof event.detail !== "string") return;
    let method = "";
    try {
      method = JSON.parse(event.detail)?.method || "";
    } catch (_error) {
      return;
    }
    await chobitsu.sendRawMessage(event.detail);
    publishDocumentState(method);
  });

  window.__te2DevToolsTarget = Object.freeze({
    protocolVersion: 1,
  });
})();
