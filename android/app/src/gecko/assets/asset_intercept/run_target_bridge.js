/* Page-facing request shim; native socket ownership remains in Kotlin. */
const RUN_TARGET_REQUEST = "te2.runTarget.resolve.request";
const RUN_TARGET_RESPONSE = "te2.runTarget.resolve.response";

function markBridgeAvailable() {
  if (document.documentElement) {
    document.documentElement.dataset.te2RunTargetBridge = "1";
  }
}

markBridgeAvailable();
document.addEventListener("DOMContentLoaded", markBridgeAvailable, { once: true });

window.addEventListener("message", async (event) => {
  if (event.source !== window || !event.data || event.data.channel !== RUN_TARGET_REQUEST) return;
  const requestId = String(event.data.requestId || "");
  if (!requestId) return;
  try {
    const response = await browser.runtime.sendMessage({
      type: "run_target_resolve",
      requestId,
      route: event.data.route,
      pageOrigin: window.location.origin,
    });
    window.postMessage({
      channel: RUN_TARGET_RESPONSE,
      requestId,
      result: response || { ok: false, error: "Native run target bridge returned no response" },
    }, window.location.origin);
  } catch (error) {
    window.postMessage({
      channel: RUN_TARGET_RESPONSE,
      requestId,
      result: {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }, window.location.origin);
  }
});
