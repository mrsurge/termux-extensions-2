(function installTe2DevToolsTargetNativeBridge() {
  "use strict";

  const targetConfig = globalThis.__te2DevToolsTargetConfig;
  if (!targetConfig || targetConfig.devTools !== true) return;

  const nativeAppId = "te2_devtools_target";
  const inboundEvent = "te2-devtools-target-inbound";
  const outboundEvent = "te2-devtools-target-outbound";
  const statusEvent = "te2-devtools-target-status";
  let port = null;
  let reconnectTimer = 0;
  let runtimeVerification = null;

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

  function announceTargetReady() {
    if (!runtimeVerification) return;
    post({
      type: "target_ready",
      targetId: targetConfig.targetId,
      targetLabel: targetConfig.targetLabel,
      isTopLevel: targetConfig.isTopLevel,
      runtimeVerified: true,
      runtimeVerification,
      url: location.href,
      title: document.title,
    });
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
      announceTargetReady();
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
    try {
      const payload = JSON.parse(event.detail);
      const detail = payload?.detail;
      if (
        payload?.state === "ready" &&
        detail?.hasChobitsu === true &&
        detail?.hasTargetRuntime === true
      ) {
        runtimeVerification = {
          hasChobitsu: true,
          hasTargetRuntime: true,
        };
        announceTargetReady();
      } else if (payload?.state === "error") {
        runtimeVerification = null;
      }
    } catch (_error) {
      runtimeVerification = null;
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    announceTargetReady();
  });

  connect();
})();
