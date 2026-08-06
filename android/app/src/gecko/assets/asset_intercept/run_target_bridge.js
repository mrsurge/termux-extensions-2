/* Page-facing dev-runtime policy shim. Proxy ownership remains entirely native. */
const RUN_TARGET_REGISTER = "te2.runTarget.register.request";
const RUN_TARGET_REGISTER_RESPONSE = "te2.runTarget.register.response";
const RUN_TARGET_RELEASE = "te2.runTarget.release.request";

function markBridgeAvailable() {
  if (document.documentElement) {
    document.documentElement.dataset.te2RunTargetBridge = "1";
  }
}

markBridgeAvailable();
document.addEventListener("DOMContentLoaded", markBridgeAvailable, { once: true });

window.addEventListener("message", async (event) => {
  if (event.source !== window || !event.data || event.data.channel !== RUN_TARGET_REGISTER) return;
  const requestId = String(event.data.requestId || "");
  if (!requestId) return;
  let result;
  try {
    result = await browser.runtime.sendMessage({
      type: "run_target_register",
      requestId,
      runtime: event.data.runtime,
      url: event.data.url,
      route: event.data.route,
      pageOrigin: window.location.origin,
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  window.postMessage({
    channel: RUN_TARGET_REGISTER_RESPONSE,
    requestId,
    result: result || { ok: false, error: "Native runtime registration returned no response" },
  }, window.location.origin);
});

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.channel !== RUN_TARGET_RELEASE) return;
  const surfaceId = String(event.data.surfaceId || "").trim();
  if (!surfaceId) return;
  void browser.runtime.sendMessage({
    type: "run_target_release",
    surfaceId,
    pageOrigin: window.location.origin,
  });
});
