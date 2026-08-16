(function installTe2DevToolsInspectorClient() {
  "use strict";

  const nativeAppId = "te2_devtools_client";
  const root = document.querySelector("#devtools-root");
  const status = document.querySelector("#devtools-status");
  const targetSelect = document.querySelector("#devtools-target");
  const parentOrigin = location.origin;
  const inboundQueue = [];
  let inboundBytes = 0;
  let frame = null;
  let frameReady = false;
  let nativePort = null;
  let reconnectTimer = 0;
  let targetReady = false;
  let targetGeneration = 0;
  let activeTargetId = "";
  let targets = [];

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
    if (typeof window.cefriumQuery === "function") {
      window.cefriumQuery({
        request: JSON.stringify({
          method: "te2.devTools.message",
          params: message,
        }),
        onSuccess() {},
        onFailure() {
          scheduleReconnect();
        },
      });
      return;
    }
    window.Te2DevToolsInspectorNative?.postMessage(JSON.stringify(message));
  }

  function publishClientState(reason) {
    postNative({
      type: "client_state",
      reason,
      activeTargetId,
      targetCount: targets.length,
      targets: targets.map((target) => ({ ...target })),
      selectedValue: targetSelect.value,
      disabled: targetSelect.disabled,
      options: [...targetSelect.options].map((option) => ({
        value: option.value,
        text: option.textContent || "",
      })),
    });
  }

  function renderTargets() {
    targetSelect.replaceChildren();
    if (!targets.length) {
      const option = document.createElement("option");
      option.textContent = "Waiting for inspected page...";
      targetSelect.appendChild(option);
      targetSelect.disabled = true;
      publishClientState("render_empty");
      return;
    }

    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.targetId;
      option.textContent = target.title
        ? `${target.targetLabel} — ${target.title}`
        : target.targetLabel;
      option.title = target.url || target.targetId;
      targetSelect.appendChild(option);
    }
    targetSelect.disabled = false;
    targetSelect.value = activeTargetId;
    publishClientState("render_targets");
  }

  function handleNativeMessage(message) {
    if (message?.type === "protocol" && typeof message.payload === "string") {
      queueInbound(message.payload);
      return;
    }
    if (message?.type === "target_reset") {
      const nextGeneration =
        Number(message.generation) || targetGeneration + 1;
      if (targetReady && nextGeneration === targetGeneration) {
        if (frameReady) setStatus("");
        return;
      }
      const hadTarget = targetReady;
      targetGeneration = nextGeneration;
      targetReady = true;
      setStatus("Connecting developer tools...");
      if (!frame || hadTarget) createFrontend();
      return;
    }
    if (message?.type === "targets_changed") {
      targets = Array.isArray(message.targets) ? message.targets : [];
      activeTargetId =
        typeof message.activeTargetId === "string" ? message.activeTargetId : "";
      renderTargets();
      return;
    }
    if (message?.type === "debug_state_request") {
      publishClientState("native_request");
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
      if (typeof window.cefriumQuery === "function") {
        postNative({ type: "client_ready" });
        publishClientState("cefrium_connected");
        return;
      }
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
      publishClientState("native_connected");
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

  targetSelect.addEventListener("change", () => {
    const targetId = targetSelect.value;
    if (!targetId || targetId === activeTargetId) return;
    postNative({ type: "target_select", targetId });
    publishClientState("target_change");
  });

  window.addEventListener("pageshow", () => publishClientState("pageshow"));

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
        activeTargetId,
        targets: targets.map((target) => ({ ...target })),
        selectedValue: targetSelect.value,
        options: [...targetSelect.options].map((option) => ({
          value: option.value,
          text: option.textContent || "",
        })),
        frameReady,
        queuedMessages: inboundQueue.length,
        queuedBytes: inboundBytes,
      };
    },
    connectNative,
  });

  createFrontend();
  if (typeof window.cefriumQuery !== "function") connectNative();
})();
