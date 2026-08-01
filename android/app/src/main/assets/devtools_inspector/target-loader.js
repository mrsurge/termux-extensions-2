(function loadTe2DevToolsTarget() {
  "use strict";

  if (!globalThis.__te2DevToolsTargetConfig) return;

  const statusEvent = "te2-devtools-target-status";

  function errorText(error) {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error || "unknown error");
  }

  function report(state, detail) {
    document.dispatchEvent(
      new CustomEvent(statusEvent, {
        detail: JSON.stringify({
          state,
          detail: detail || null,
          url: location.href,
        }),
      }),
    );
  }

  function readPackagedScript(name) {
    const url = browser.runtime.getURL(name);
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send(null);
    if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
      throw new Error(`HTTP ${request.status} while loading ${name}`);
    }
    if (!request.responseText) throw new Error(`${name} is empty`);
    return { source: request.responseText, url };
  }

  function evaluatePackagedScript(name) {
    const script = readPackagedScript(name);
    window.eval(`${script.source}\n//# sourceURL=${script.url}`);
  }

  function verifyPageRuntime() {
    const serialized = window.eval(`JSON.stringify({
      hasChobitsu: Boolean(
        window.chobitsu && typeof window.chobitsu.sendRawMessage === "function"
      ),
      hasTargetRuntime: Boolean(
        window.__te2DevToolsTarget &&
          window.__te2DevToolsTarget.protocolVersion === 1
      )
    })`);
    const verification = JSON.parse(String(serialized || "{}"));
    if (!verification.hasChobitsu || !verification.hasTargetRuntime) {
      throw new Error("Page-world Chobitsu target verification failed");
    }
    return verification;
  }

  try {
    evaluatePackagedScript("chobitsu.js");
    evaluatePackagedScript("target-runtime.js");
    report("ready", verifyPageRuntime());
  } catch (error) {
    report("error", errorText(error));
  }
})();
