(function installTe2DevToolsTargetNativeBridge() {
  "use strict";

  const nativeAppId = "te2_devtools_target";
  const inboundEvent = "te2-devtools-target-inbound";
  const outboundEvent = "te2-devtools-target-outbound";
  const statusEvent = "te2-devtools-target-status";
  let port = null;
  let reconnectTimer = 0;

  function post(message) {
    if (!port) return;
    try {
      port.postMessage(message);
    } catch (_error) {
      // The disconnect callback owns reconnection and target reset.
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      connect();
    }, 250);
  }

  function connect() {
    try {
      const nextPort = browser.runtime.connectNative(nativeAppId);
      port = nextPort;
      nextPort.onMessage.addListener((message) => {
        if (message?.type !== "protocol" || typeof message.payload !== "string") {
          return;
        }
        document.dispatchEvent(
          new CustomEvent(inboundEvent, { detail: message.payload }),
        );
      });
      nextPort.onDisconnect.addListener(() => {
        if (port === nextPort) port = null;
        scheduleReconnect();
      });
      post({
        type: "target_ready",
        url: location.href,
        title: document.title,
      });
    } catch (_error) {
      port = null;
      scheduleReconnect();
    }
  }

  document.addEventListener(outboundEvent, (event) => {
    if (typeof event.detail !== "string") return;
    post({ type: "protocol", payload: event.detail });
  });
  document.addEventListener(statusEvent, (event) => {
    if (typeof event.detail !== "string") return;
    post({ type: "target_status", payload: event.detail });
  });

  connect();
})();
