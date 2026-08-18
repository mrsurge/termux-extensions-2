(function defineTe2CefriumTargetRuntime() {
  "use strict";

  if (globalThis.__te2InstallCefriumDevToolsTarget) return;

  function publishDocumentState(send, method) {
    if (method === "DOM.enable") {
      send(JSON.stringify({ method: "DOM.documentUpdated", params: {} }));
      return;
    }
    if (method !== "Page.enable") return;

    send(
      JSON.stringify({
        method: "Page.frameNavigated",
        params: {
          frame: {
            id: "1",
            mimeType: document.contentType || "text/html",
            securityOrigin: location.origin,
            url: location.href,
          },
          type: "Navigation",
        },
      }),
    );
    send(
      JSON.stringify({
        method: "Page.loadEventFired",
        params: { timestamp: Date.now() / 1000 },
      }),
    );
  }

  Object.defineProperty(globalThis, "__te2InstallCefriumDevToolsTarget", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(bindingName) {
      const chobitsu = globalThis.chobitsu;
      const send = (message) => {
        const binding = globalThis[bindingName];
        if (typeof binding === "function") binding(String(message));
      };
      if (!chobitsu || typeof chobitsu.sendRawMessage !== "function") {
        throw new Error("Chobitsu target runtime unavailable");
      }

      chobitsu.setOnMessage(send);
      const target = Object.freeze({
        bindingName,
        protocolVersion: 1,
        async receive(message) {
          const payload = String(message);
          let method = "";
          try {
            method = JSON.parse(payload)?.method || "";
          } catch (_error) {
            return;
          }
          await chobitsu.sendRawMessage(payload);
          publishDocumentState(send, method);
        },
      });
      Object.defineProperty(globalThis, "__te2CefriumDevToolsTarget", {
        configurable: true,
        enumerable: false,
        writable: false,
        value: target,
      });
      return true;
    },
  });
})();
