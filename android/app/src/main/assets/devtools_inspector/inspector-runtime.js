(function installTe2DevToolsInspectorClient() {
  "use strict";

  const nativeAppId = "te2_devtools_client";
  const root = document.querySelector("#devtools-root");
  const status = document.querySelector("#devtools-status");
  const parentOrigin = location.origin;
  const inboundQueue = [];
  let inboundBytes = 0;
  let frame = null;
  let frameReady = false;
  let nativePort = null;
  let reconnectTimer = 0;
  let targetReady = false;
  let targetGeneration = 0;

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function frameUrl() {
    return `front_end/chii_app.html#?embedded=${encodeURIComponent(parentOrigin)}`;
  }

  function flushInbound() {
    if (!frameReady || !frame?.contentWindow) return;
    while (inboundQueue.length) {
      const payload = inboundQueue.shift();
      inboundBytes -= payload.length;
      frame.contentWindow.postMessage(payload, parentOrigin);
    }
  }

  function createFrontend() {
    frameReady = false;
    inboundQueue.length = 0;
    inboundBytes = 0;
    frame?.remove();
    frame = document.createElement("iframe");
    frame.title = "Developer Tools";
    frame.addEventListener("load", () => {
      frameReady = true;
      if (targetReady) setStatus("");
      flushInbound();
    });
    frame.src = frameUrl();
    root.appendChild(frame);
  }

  function queueInbound(payload) {
    if (frameReady && frame?.contentWindow) {
      frame.contentWindow.postMessage(payload, parentOrigin);
      return;
    }
    inboundQueue.push(payload);
    inboundBytes += payload.length;
    while (inboundQueue.length > 512 || inboundBytes > 4 * 1024 * 1024) {
      inboundBytes -= inboundQueue.shift().length;
    }
  }

  function postNative(message) {
    if (nativePort) {
      nativePort.postMessage(message);
      return;
    }
    window.Te2DevToolsInspectorNative?.postMessage(JSON.stringify(message));
  }

  function handleNativeMessage(message) {
    if (message?.type === "protocol" && typeof message.payload === "string") {
      queueInbound(message.payload);
      return;
    }
    if (message?.type === "target_reset") {
      targetGeneration = Number(message.generation) || targetGeneration + 1;
      targetReady = true;
      setStatus("Connecting developer tools...");
      createFrontend();
      return;
    }
    if (message?.type === "target_waiting") {
      targetReady = false;
      setStatus("Waiting for inspected page...");
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      connectNative();
    }, 250);
  }

  function connectNative() {
    if (!globalThis.browser?.runtime?.connectNative) {
      window.Te2DevToolsInspectorNative?.clientReady();
      return;
    }
    try {
      const nextPort = browser.runtime.connectNative(nativeAppId);
      nativePort = nextPort;
      nextPort.onMessage.addListener(handleNativeMessage);
      nextPort.onDisconnect.addListener(() => {
        if (nativePort === nextPort) nativePort = null;
        targetReady = false;
        setStatus("Developer-tools bridge disconnected; reconnecting...");
        scheduleReconnect();
      });
      postNative({ type: "client_ready" });
    } catch (_error) {
      nativePort = null;
      scheduleReconnect();
    }
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== frame?.contentWindow ||
      event.origin !== parentOrigin ||
      typeof event.data !== "string"
    ) {
      return;
    }
    postNative({ type: "protocol", payload: event.data });
  });

  window.__te2DevToolsInspector = Object.freeze({
    receiveNativeMessage(payload) {
      if (typeof payload !== "string") return;
      try {
        handleNativeMessage(JSON.parse(payload));
      } catch (_error) {
        // Ignore malformed native bridge messages.
      }
    },
    getState() {
      return {
        targetReady,
        targetGeneration,
        frameReady,
        queuedMessages: inboundQueue.length,
        queuedBytes: inboundBytes,
      };
    },
  });

  createFrontend();
  connectNative();
})();
