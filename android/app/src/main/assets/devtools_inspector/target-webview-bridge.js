(function installTe2DevToolsTargetWebViewBridge() {
  "use strict";

  const inboundEvent = "te2-devtools-target-inbound";
  const outboundEvent = "te2-devtools-target-outbound";
  const statusEvent = "te2-devtools-target-status";
  const nativeBridge = window.Te2DevToolsTargetNative;

  if (!nativeBridge) {
    throw new Error("TE2 WebView developer-tools bridge unavailable");
  }

  function post(message) {
    nativeBridge.postMessage(JSON.stringify(message));
  }

  window.__te2DevToolsTargetReceiveNative = (payload) => {
    if (typeof payload !== "string") return;
    document.dispatchEvent(
      new CustomEvent(inboundEvent, { detail: payload }),
    );
  };

  document.addEventListener(outboundEvent, (event) => {
    if (typeof event.detail !== "string") return;
    post({ type: "protocol", payload: event.detail });
  });
  document.addEventListener(statusEvent, (event) => {
    if (typeof event.detail !== "string") return;
    post({ type: "target_status", payload: event.detail });
  });

  post({
    type: "target_ready",
    url: location.href,
    title: document.title,
  });
})();
